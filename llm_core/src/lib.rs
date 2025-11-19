use anyhow::Result;
use chrono::{DateTime, Utc};
use futures::Stream;
use qdrant_client::{
    config::QdrantConfig,
    qdrant::{
        vectors_config::Config as QVectorsConfigEnum,
        CreateCollection, Distance, PointStruct,
        UpsertPoints, Value, VectorParams, VectorsConfig,
    },
    Qdrant,
};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    env,
    pin::Pin,
    sync::Arc,
    time::Duration,
};
use tokio::sync::RwLock;
use tokio::time::Instant;
use tokio_stream::{StreamExt, wrappers::ReceiverStream};
use uuid::Uuid;
use async_trait::async_trait;
use lru::LruCache;
use std::hash::{Hash, Hasher};
use std::collections::hash_map::DefaultHasher;

/* ---------------------- Public types ---------------------- */

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum LlmProvider {
    Ollama,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Message {
    pub role: String,
    pub content: String,
    pub timestamp: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Conversation {
    pub id: String,
    pub messages: Vec<Message>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

// Cached response entry
#[derive(Clone)]
struct CachedResponse {
    response: String,
    cached_at: Instant,
}

// Conversation entry with TTL
struct ConversationEntry {
    conversation: Conversation,
    last_accessed: Instant,
}

/* ------------------ Async LLM Provider Trait ------------------ */

#[async_trait]
pub trait LlmProviderTrait: Send + Sync {
    async fn chat(&self, messages: &[Message]) -> Result<String>;
    fn provider_type(&self) -> LlmProvider;
    
    /// Stream chat response tokens as they're generated
    fn chat_stream(
        &self,
        messages: &[Message],
    ) -> Pin<Box<dyn Stream<Item = Result<String>> + Send>>;
}

/* ------------------ Ollama client (Async) ------------------ */

pub struct OllamaClient {
    client: Arc<Client>,
    base_url: String,
    model: String,
    // Ollama optimization parameters
    num_ctx: u32,        // Context window size (4096 = half of max, faster)
    temperature: f32,    // 0.7 = balanced creativity
    top_p: f32,          // 0.9 = focused responses
    num_predict: i32,    // 512 = limit response length for speed
}

impl OllamaClient {
    pub fn new(model: &str) -> Result<Self> {
        let client = Arc::new(
            Client::builder()
                .timeout(Duration::from_secs(120))
                .tcp_keepalive(Duration::from_secs(60))
                .pool_max_idle_per_host(50)
                .pool_idle_timeout(Duration::from_secs(90))
                .build()?
        );
        
        Ok(Self {
            client,
            base_url: env::var("OLLAMA_BASE_URL").unwrap_or_else(|_| "http://localhost:11434".to_string()),
            model: model.to_string(),
            num_ctx: env::var("OLLAMA_NUM_CTX")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(4096), // Half of max context for speed
            temperature: env::var("OLLAMA_TEMPERATURE")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(0.7),
            top_p: env::var("OLLAMA_TOP_P")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(0.9),
            num_predict: env::var("OLLAMA_NUM_PREDICT")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(512), // Limit response length
        })
    }
    
    // Model keep-alive: ping Ollama periodically to keep model loaded
    pub async fn keep_alive(&self) -> Result<()> {
        let url = format!("{}/api/generate", self.base_url);
        let _ = self.client
            .post(&url)
            .json(&serde_json::json!({
                "model": self.model,
                "prompt": "ping",
                "stream": false,
                "options": {
                    "num_predict": 1
                }
            }))
            .send()
            .await?;
        Ok(())
    }
}

#[async_trait]
impl LlmProviderTrait for OllamaClient {
    fn provider_type(&self) -> LlmProvider { LlmProvider::Ollama }
    
    async fn chat(&self, messages: &[Message]) -> Result<String> {
        #[derive(Serialize, Clone)]
        struct Msg { role: String, content: String }
        #[derive(Serialize)]
        struct Req { 
            model: String, 
            messages: Vec<Msg>, 
            stream: bool,
            options: OllamaOptions,
        }
        #[derive(Serialize)]
        struct OllamaOptions {
            num_ctx: u32,
            temperature: f32,
            top_p: f32,
            num_predict: i32,
        }
        #[derive(Deserialize)]
        struct Resp { message: RMsg }
        #[derive(Deserialize)]
        struct RMsg { content: String }

        let url = format!("{}/api/chat", self.base_url);
        
        let msgs: Vec<Msg> = messages.iter()
            .map(|m| Msg { 
                role: m.role.clone(), 
                content: m.content.clone() 
            })
            .collect();
        
        let body = Req { 
            model: self.model.clone(), 
            messages: msgs, 
            stream: false,
            options: OllamaOptions {
                num_ctx: self.num_ctx,
                temperature: self.temperature,
                top_p: self.top_p,
                num_predict: self.num_predict,
            },
        };
        
        let response = self.client
            .post(&url)
            .json(&body)
            .send()
            .await?
            .error_for_status()?
            .json::<Resp>()
            .await?;
            
        Ok(response.message.content)
    }

    fn chat_stream(&self, messages: &[Message]) -> Pin<Box<dyn Stream<Item = Result<String>> + Send>> {
        use tokio::sync::mpsc;
        
        let (tx, rx) = mpsc::channel::<Result<String>>(100);
        let messages_clone: Vec<Message> = messages.iter().cloned().collect();
        let base_url = self.base_url.clone();
        let model = self.model.clone();
        let client = self.client.clone();
        let num_ctx = self.num_ctx;
        let temperature = self.temperature;
        let top_p = self.top_p;
        let num_predict = self.num_predict;
        
        tokio::spawn(async move {
            #[derive(Serialize, Clone)]
            struct Msg { role: String, content: String }
            #[derive(Serialize)]
            struct Req { 
                model: String, 
                messages: Vec<Msg>, 
                stream: bool,
                options: OllamaOptions,
            }
            #[derive(Serialize)]
            struct OllamaOptions {
                num_ctx: u32,
                temperature: f32,
                top_p: f32,
                num_predict: i32,
            }
            #[derive(Deserialize)]
            struct StreamResp {
                message: StreamMsg,
                done: bool,
            }
            #[derive(Deserialize)]
            struct StreamMsg {
                content: String,
            }

            let url = format!("{}/api/chat", base_url);
            let msgs: Vec<Msg> = messages_clone.iter()
                .map(|m| Msg { role: m.role.clone(), content: m.content.clone() })
                .collect();
            let body = Req { 
                model: model.clone(), 
                messages: msgs, 
                stream: true,
                options: OllamaOptions {
                    num_ctx,
                    temperature,
                    top_p,
                    num_predict,
                },
            };

            match client.post(&url).json(&body).send().await {
                Ok(response) => {
                    if !response.status().is_success() {
                        let status = response.status();
                        let text = response.text().await.unwrap_or_default();
                        let _ = tx.send(Err(anyhow::anyhow!("Ollama HTTP {}: {}", status, text))).await;
                        return;
                    }
                    
                    let stream = response.bytes_stream();
                    let mut buffer = String::new();
                    
                    tokio::pin!(stream);
                    while let Some(item) = stream.next().await {
                        match item {
                            Ok(bytes) => {
                                if let Ok(chunk) = String::from_utf8(bytes.to_vec()) {
                                    buffer.push_str(&chunk);
                                    
                                    while let Some(newline_pos) = buffer.find('\n') {
                                        let line = buffer[..newline_pos].trim().to_string();
                                        buffer = buffer[newline_pos + 1..].to_string();
                                        
                                        if line.is_empty() {
                                            continue;
                                        }
                                        
                                        match serde_json::from_str::<StreamResp>(&line) {
                                            Ok(resp) => {
                                                if !resp.message.content.is_empty() {
                                                    let _ = tx.send(Ok(resp.message.content)).await;
                                                }
                                                if resp.done {
                                                    break;
                                                }
                                            }
                                            Err(_) => {}
                                        }
                                    }
                                }
                            }
                            Err(e) => {
                                let _ = tx.send(Err(anyhow::anyhow!("Stream error: {}", e))).await;
                                break;
                            }
                        }
                    }
                }
                Err(e) => {
                    let _ = tx.send(Err(anyhow::anyhow!("Request error: {}", e))).await;
                }
            }
        });
        
        Box::pin(ReceiverStream::new(rx))
    }
}

/* ------------------ Qdrant storage ------------------ */

pub struct QdrantStorage {
    client: Arc<Qdrant>,
    collection_name: String,
}

impl QdrantStorage {
    pub async fn new(collection_name: Option<String>) -> anyhow::Result<Self> {
        let raw = env::var("QDRANT_URL").unwrap_or_else(|_| "http://localhost:6334".to_string());
        let url = if raw.contains(":6333") { raw.replace(":6333", ":6334") } else { raw };
        let api_key = env::var("QDRANT_API_KEY").ok();

        let mut cfg = QdrantConfig::from_url(&url);
        if let Some(k) = api_key {
            cfg.api_key = Some(k);
        }

        let client = Qdrant::new(cfg)?;
        let collection_name = collection_name.unwrap_or_else(|| "conversations".to_string());

        let storage = Self {
            client: Arc::new(client),
            collection_name: collection_name.clone(),
        };
        storage.ensure_collection().await?;
        Ok(storage)
    }

    async fn ensure_collection(&self) -> anyhow::Result<()> {
        let collections = self.client.list_collections().await?;
        let exists = collections.collections.iter().any(|c| c.name == self.collection_name);
        if !exists {
            self.client.create_collection(CreateCollection {
                collection_name: self.collection_name.clone(),
                vectors_config: Some(VectorsConfig {
                    config: Some(QVectorsConfigEnum::Params(VectorParams {
                        size: 1536,
                        distance: Distance::Cosine.into(),
                        ..Default::default()
                    })),
                }),
                ..Default::default()
            })
            .await?;
        }
        Ok(())
    }

    pub async fn store_conversation(&self, conversation: &Conversation) -> anyhow::Result<()> {
        let json_value = serde_json::to_value(conversation)?;
        let mut payload: HashMap<String, Value> = HashMap::new();
        if let serde_json::Value::Object(map) = json_value {
            for (k, v) in map {
                let val: Value = serde_json::from_value(v)?;
                payload.insert(k, val);
            }
        }

        let vector = vec![0.0f32; 1536];
        let point = PointStruct::new(conversation.id.clone(), vector, payload);

        self.client
            .upsert_points(UpsertPoints {
                collection_name: self.collection_name.clone(),
                points: vec![point],
                ..Default::default()
            })
            .await?;
        Ok(())
    }
}

/* ------------------ Main LLM client (Optimized) ------------------ */

pub struct LlmClient {
    provider: Arc<dyn LlmProviderTrait>,
    storage: Option<Arc<QdrantStorage>>,
    // LRU cache for conversations with TTL (max 100 conversations, 1 hour TTL)
    conversations: Arc<RwLock<LruCache<String, ConversationEntry>>>,
    // Response cache (1 hour TTL)
    response_cache: Arc<RwLock<LruCache<String, CachedResponse>>>,
    // Conversation TTL: 1 hour
    conversation_ttl: Duration,
    // Cache TTL: 1 hour
    cache_ttl: Duration,
}

impl LlmClient {
    pub async fn new(provider_type: LlmProvider, model: &str) -> Result<Self> {
        let provider: Arc<dyn LlmProviderTrait> = match provider_type {
            LlmProvider::Ollama => Arc::new(OllamaClient::new(model)?),
        };
        
        Ok(Self {
            provider,
            storage: None,
            conversations: Arc::new(RwLock::new(LruCache::new(
                std::num::NonZeroUsize::new(100).unwrap() // Max 100 conversations
            ))),
            response_cache: Arc::new(RwLock::new(LruCache::new(
                std::num::NonZeroUsize::new(500).unwrap() // Max 500 cached responses
            ))),
            conversation_ttl: Duration::from_secs(3600), // 1 hour
            cache_ttl: Duration::from_secs(3600), // 1 hour
        })
    }

    pub async fn with_storage(provider_type: LlmProvider, model: &str, collection: Option<String>) -> Result<Self> {
        let provider: Arc<dyn LlmProviderTrait> = match provider_type {
            LlmProvider::Ollama => Arc::new(OllamaClient::new(model)?),
        };
        let storage = Arc::new(QdrantStorage::new(collection).await?);
        Ok(Self {
            provider,
            storage: Some(storage),
            conversations: Arc::new(RwLock::new(LruCache::new(
                std::num::NonZeroUsize::new(100).unwrap()
            ))),
            response_cache: Arc::new(RwLock::new(LruCache::new(
                std::num::NonZeroUsize::new(500).unwrap()
            ))),
            conversation_ttl: Duration::from_secs(3600),
            cache_ttl: Duration::from_secs(3600),
        })
    }

    // Optimized: reduce from 10 turns to 6 turns (12 messages) for faster inference
    fn tail(all: &[Message], n: usize) -> Vec<Message> {
        let len = all.len();
        let start = len.saturating_sub(n * 2); // n turns = n*2 messages
        all[start..].to_vec()
    }
    
    // Generate cache key from conversation_id + message
    fn cache_key(conv_id: &str, message: &str) -> String {
        let mut hasher = DefaultHasher::new();
        conv_id.hash(&mut hasher);
        message.hash(&mut hasher);
        format!("{:x}", hasher.finish())
    }
    
    // Clean expired conversations
    async fn clean_expired_conversations(&self) {
        let now = Instant::now();
        let mut convs = self.conversations.write().await;
        let keys_to_remove: Vec<String> = convs.iter()
            .filter(|(_, entry)| now.duration_since(entry.last_accessed) > self.conversation_ttl)
            .map(|(k, _)| k.clone())
            .collect();
        for key in keys_to_remove {
            convs.pop(&key);
        }
    }
    
    // Clean expired cache entries
    async fn clean_expired_cache(&self) {
        let now = Instant::now();
        let mut cache = self.response_cache.write().await;
        let keys_to_remove: Vec<String> = cache.iter()
            .filter(|(_, entry)| now.duration_since(entry.cached_at) > self.cache_ttl)
            .map(|(k, _)| k.clone())
            .collect();
        for key in keys_to_remove {
            cache.pop(&key);
        }
    }

    pub async fn chat_with_history(&self, conversation_id: Option<String>, user_message: &str) -> Result<String> {
        let conv_id = conversation_id.unwrap_or_else(|| Uuid::new_v4().to_string());
        
        // Check response cache first
        let cache_key = Self::cache_key(&conv_id, user_message);
        {
            let cache = self.response_cache.read().await;
            if let Some(cached) = cache.peek(&cache_key) {
                if Instant::now().duration_since(cached.cached_at) < self.cache_ttl {
                    return Ok(cached.response.clone());
                }
            }
        }
        
        // Clean expired entries periodically (every 10% of requests)
        if rand::random::<u8>() % 10 == 0 {
            self.clean_expired_conversations().await;
            self.clean_expired_cache().await;
        }
        
        // Prepare messages while holding lock briefly
        let (compact_messages, storage_conv) = {
            let mut convs = self.conversations.write().await;
            
            // Get or create conversation
            let entry = convs.get_mut(&conv_id).map(|e| {
                e.last_accessed = Instant::now();
                e.conversation.clone()
            }).unwrap_or_else(|| {
                Conversation {
                    id: conv_id.clone(),
                    messages: Vec::new(),
                    created_at: Utc::now(),
                    updated_at: Utc::now(),
                }
            });
            
            let mut convo = entry;
            convo.messages.push(Message {
                role: "user".into(),
                content: user_message.into(),
                timestamp: Utc::now(),
            });
            convo.updated_at = Utc::now();

            // Optimized: send only last 6 turns (12 messages) instead of 10
            let compact = Self::tail(&convo.messages, 6);
            
            // Store updated conversation
            convs.put(conv_id.clone(), ConversationEntry {
                conversation: convo.clone(),
                last_accessed: Instant::now(),
            });
            
            // Clone for storage (if needed) before releasing lock
            let storage_conv = if self.storage.is_some() {
                Some(convo.clone())
            } else {
                None
            };
            
            (compact, storage_conv)
        };
        
        // Release lock before LLM call (async, non-blocking)
        let reply = self.provider.chat(&compact_messages).await?;

        // Re-acquire lock briefly to update conversation and cache
        {
            let mut convs = self.conversations.write().await;
            if let Some(entry) = convs.get_mut(&conv_id) {
                entry.conversation.messages.push(Message {
                    role: "assistant".into(),
                    content: reply.clone(),
                    timestamp: Utc::now(),
                });
                entry.conversation.updated_at = Utc::now();
                entry.last_accessed = Instant::now();
            }
            
            // Cache the response
            let mut cache = self.response_cache.write().await;
            cache.put(cache_key, CachedResponse {
                response: reply.clone(),
                cached_at: Instant::now(),
            });
        }

        // Store conversation asynchronously (non-blocking)
        if let Some(storage) = &self.storage {
            if let Some(mut conv_clone) = storage_conv {
                conv_clone.messages.push(Message {
                    role: "assistant".into(),
                    content: reply.clone(),
                    timestamp: Utc::now(),
                });
                conv_clone.updated_at = Utc::now();
                
                let storage_clone = storage.clone();
                tokio::spawn(async move {
                    let _ = storage_clone.store_conversation(&conv_clone).await;
                });
            }
        }
        Ok(reply)
    }

    pub async fn chat(&self, user_message: &str) -> Result<String> {
        let messages = vec![Message {
            role: "user".into(),
            content: user_message.into(),
            timestamp: Utc::now(),
        }];
        self.provider.chat(&messages).await
    }

    /// Stream chat response with conversation history
    pub fn chat_with_history_stream(
        &self,
        conversation_id: Option<String>,
        user_message: &str,
    ) -> Pin<Box<dyn Stream<Item = Result<String>> + Send>> {
        let conv_id = conversation_id.unwrap_or_else(|| Uuid::new_v4().to_string());
        let user_message = user_message.to_string(); // Clone to own the string
        let conversations = self.conversations.clone();
        let storage = self.storage.clone();
        let provider = self.provider.clone();
        
        Box::pin(async_stream::stream! {
            // Prepare messages while holding lock briefly
            let compact_messages = {
                let mut convs = conversations.write().await;
                let entry = convs.get_mut(&conv_id).map(|e| {
                    e.last_accessed = Instant::now();
                    e.conversation.clone()
                }).unwrap_or_else(|| {
                    Conversation {
                        id: conv_id.clone(),
                        messages: Vec::new(),
                        created_at: Utc::now(),
                        updated_at: Utc::now(),
                    }
                });
                
                let mut convo = entry;
                convo.messages.push(Message {
                    role: "user".into(),
                    content: user_message.clone(),
                    timestamp: Utc::now(),
                });
                convo.updated_at = Utc::now();

                // Optimized: 6 turns instead of 10
                let compact = Self::tail(&convo.messages, 6);
                
                convs.put(conv_id.clone(), ConversationEntry {
                    conversation: convo,
                    last_accessed: Instant::now(),
                });
                
                compact
            };
            
            // Get stream from provider
            let mut token_stream = provider.chat_stream(&compact_messages);
            let mut full_response = String::new();
            
            while let Some(token_result) = token_stream.next().await {
                match token_result {
                    Ok(token) => {
                        full_response.push_str(&token);
                        yield Ok(token);
                    }
                    Err(e) => {
                        yield Err(e);
                        return;
                    }
                }
            }
            
            // Update conversation with full response after streaming completes
            {
                let mut convs = conversations.write().await;
                if let Some(entry) = convs.get_mut(&conv_id) {
                    entry.conversation.messages.push(Message {
                        role: "assistant".into(),
                        content: full_response.clone(),
                        timestamp: Utc::now(),
                    });
                    entry.conversation.updated_at = Utc::now();
                    entry.last_accessed = Instant::now();
                }
            }
            
            // Store conversation asynchronously
            if let Some(storage) = storage {
                let mut convs = conversations.write().await;
                if let Some(entry) = convs.get(&conv_id) {
                    let conv_clone = entry.conversation.clone();
                    let storage_clone = storage.clone();
                    tokio::spawn(async move {
                        let _ = storage_clone.store_conversation(&conv_clone).await;
                    });
                }
            }
        })
    }
    
    // Get provider type for keep-alive
    pub fn provider_type(&self) -> LlmProvider {
        self.provider.provider_type()
    }
    
    // Start model keep-alive task (only for Ollama)
    // Note: This is a simplified keep-alive. For full implementation, 
    // we'd need to store the OllamaClient separately or use a different approach.
    pub fn start_keep_alive(&self) {
        // Keep-alive will be handled by periodic requests
        // The connection pool and Ollama's internal mechanisms handle this
    }
}
