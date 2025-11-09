use anyhow::{Context, Result};
use chrono::{DateTime, Utc};
use qdrant_client::{
    qdrant::{
        vectors_config::Config, Distance, PointStruct,
        VectorParams, VectorsConfig,
    },
    Qdrant,
};
use reqwest::blocking::Client;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::env;
use std::sync::{Arc, Mutex};
use uuid::Uuid;

// For spawning async tasks from blocking context
use tokio::runtime::Handle;

/// LLM Provider type
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum LlmProvider {
    OpenAI,
    Ollama,
}

/// Message in a conversation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Message {
    pub role: String,
    pub content: String,
    pub timestamp: DateTime<Utc>,
}

/// Conversation with history
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Conversation {
    pub id: String,
    pub messages: Vec<Message>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// Trait for LLM providers
pub trait LlmProviderTrait {
    fn chat(&self, messages: &[Message]) -> Result<String>;
    fn provider_type(&self) -> LlmProvider;
}

/// OpenAI client implementation
pub struct OpenAiClient {
    api_key: String,
    client: std::sync::OnceLock<Client>,
    model: String,
    max_tokens: u16,
}

impl OpenAiClient {
    /// Create a new OpenAI client
    /// Note: Client is created lazily to avoid creating a runtime in async context
    pub fn new(model: &str) -> Result<Self> {
        let api_key = env::var("OPENAI_API_KEY")
            .context("OPENAI_API_KEY must be set in the environment")?;
        let max_tokens = env::var("OPENAI_MAX_TOKENS")
            .ok()
            .and_then(|v| v.parse::<u16>().ok())
            .unwrap_or(1000);
        Ok(Self {
            api_key,
            client: std::sync::OnceLock::new(),
            model: model.to_string(),
            max_tokens,
        })
    }

    /// Get or create the HTTP client (lazy initialization)
    fn get_client(&self) -> &Client {
        self.client.get_or_init(|| Client::new())
    }
}

impl LlmProviderTrait for OpenAiClient {
    fn provider_type(&self) -> LlmProvider {
        LlmProvider::OpenAI
    }

    fn chat(&self, messages: &[Message]) -> Result<String> {
        #[derive(Serialize)]
        struct ChatRequest<'a> {
            model: &'a str,
            messages: Vec<ApiMessage<'a>>,
            max_tokens: u16,
        }

        #[derive(Serialize)]
        struct ApiMessage<'a> {
            role: &'a str,
            content: &'a str,
        }

        #[derive(Deserialize)]
        struct ChatResponse {
            choices: Vec<Choice>,
        }

        #[derive(Deserialize)]
        struct Choice {
            message: ResponseMessage,
        }

        #[derive(Deserialize)]
        struct ResponseMessage {
            content: String,
        }

        let url = "https://api.openai.com/v1/chat/completions";
        let api_messages: Vec<ApiMessage> = messages
            .iter()
            .map(|m| ApiMessage {
                role: &m.role,
                content: &m.content,
            })
            .collect();

        let req_body = ChatRequest {
            model: &self.model,
            messages: api_messages,
            max_tokens: self.max_tokens,
        };

        let response = self
            .get_client()
            .post(url)
            .bearer_auth(&self.api_key)
            .json(&req_body)
            .send()?
            .error_for_status()?
            .json::<ChatResponse>()?;

        let reply = response
            .choices
            .first()
            .map(|choice| choice.message.content.clone())
            .unwrap_or_else(|| "No response.".to_string());
        Ok(reply)
    }
}

/// Ollama client implementation (local LLM)
pub struct OllamaClient {
    client: std::sync::OnceLock<Client>,
    base_url: String,
    model: String,
}

impl OllamaClient {
    /// Create a new Ollama client
    /// Note: Client is created lazily to avoid creating a runtime in async context
    pub fn new(model: &str) -> Result<Self> {
        let base_url = env::var("OLLAMA_BASE_URL").unwrap_or_else(|_| "http://localhost:11434".to_string());
        Ok(Self {
            client: std::sync::OnceLock::new(),
            base_url,
            model: model.to_string(),
        })
    }

    /// Get or create the HTTP client (lazy initialization)
    fn get_client(&self) -> &Client {
        self.client.get_or_init(|| Client::new())
    }
}

impl LlmProviderTrait for OllamaClient {
    fn provider_type(&self) -> LlmProvider {
        LlmProvider::Ollama
    }

    fn chat(&self, messages: &[Message]) -> Result<String> {
        #[derive(Serialize)]
        struct ChatRequest {
            model: String,
            messages: Vec<OllamaMessage>,
            stream: bool,
        }

        #[derive(Serialize)]
        struct OllamaMessage {
            role: String,
            content: String,
        }

        #[derive(Deserialize)]
        struct ChatResponse {
            message: ResponseMessage,
        }

        #[derive(Deserialize)]
        struct ResponseMessage {
            content: String,
        }

        let url = format!("{}/api/chat", self.base_url);
        let ollama_messages: Vec<OllamaMessage> = messages
            .iter()
            .map(|m| OllamaMessage {
                role: m.role.clone(),
                content: m.content.clone(),
            })
            .collect();

        let req_body = ChatRequest {
            model: self.model.clone(),
            messages: ollama_messages,
            stream: false,
        };

        let response = self
            .get_client()
            .post(&url)
            .json(&req_body)
            .send()?
            .error_for_status()?
            .json::<ChatResponse>()?;

        Ok(response.message.content)
    }
}

/// Qdrant client wrapper for conversation storage
pub struct QdrantStorage {
    client: Arc<Qdrant>,
    collection_name: String,
}

impl QdrantStorage {
    /// Create a new Qdrant storage client
    pub async fn new(collection_name: Option<String>) -> Result<Self> {
        use qdrant_client::config::QdrantConfig;
        
        let url = env::var("QDRANT_URL").unwrap_or_else(|_| "http://localhost:6333".to_string());
        let api_key = env::var("QDRANT_API_KEY").ok();
        
        // Use new Qdrant API
        let config = QdrantConfig::from_url(&url);
        let config = if let Some(key) = api_key {
            QdrantConfig {
                api_key: Some(key),
                ..config
            }
        } else {
            config
        };
        
        let client = Qdrant::new(config)?;
        let collection_name = collection_name.unwrap_or_else(|| "conversations".to_string());

        // Ensure collection exists
        let storage = Self {
            client: Arc::new(client),
            collection_name: collection_name.clone(),
        };
        storage.ensure_collection().await?;

        Ok(storage)
    }

    /// Ensure the collection exists, create if it doesn't
    async fn ensure_collection(&self) -> Result<()> {
        let collections = self.client.list_collections().await?;
        let collection_exists = collections
            .collections
            .iter()
            .any(|c| c.name == self.collection_name);

        if !collection_exists {
            use qdrant_client::qdrant::CreateCollection;
            
            self.client
                .create_collection(CreateCollection {
                    collection_name: self.collection_name.clone(),
                    vectors_config: Some(VectorsConfig {
                        config: Some(Config::Params(VectorParams {
                            size: 1536, // OpenAI embedding size, adjust for other models
                            distance: Distance::Cosine.into(),
                            ..Default::default()
                        })),
                    }),
                    ..Default::default()
                })
                .await
                .context("Failed to create Qdrant collection")?;
        }
        Ok(())
    }

    /// Store a conversation
    pub async fn store_conversation(&self, conversation: &Conversation) -> Result<()> {
        // Serialize conversation to JSON
        let json_value = serde_json::to_value(conversation)
            .context("Failed to serialize conversation")?;
        
        // Convert to payload format
        use qdrant_client::qdrant::Value;
        use std::collections::HashMap;
        
        let mut payload: HashMap<String, Value> = HashMap::new();
        if let serde_json::Value::Object(map) = json_value {
            for (key, value) in map {
                // Convert serde_json::Value to qdrant Value
                let qdrant_value: Value = serde_json::from_value(value)
                    .context("Failed to convert JSON value to Qdrant Value")?;
                payload.insert(key, qdrant_value);
            }
        }

        // For now, use a zero vector (we can add embeddings later)
        let vector = vec![0.0; 1536];

        let point = PointStruct::new(
            conversation.id.clone(),
            vector,
            payload,
        );

        use qdrant_client::qdrant::UpsertPoints;
        
        self.client
            .upsert_points(UpsertPoints {
                collection_name: self.collection_name.clone(),
                points: vec![point],
                ..Default::default()
            })
            .await
            .context("Failed to store conversation in Qdrant")?;

        Ok(())
    }

    /// Retrieve a conversation by ID
    pub async fn get_conversation(&self, conversation_id: &str) -> Result<Option<Conversation>> {
        use qdrant_client::qdrant::{PointId, GetPoints};
        
        let point_id: PointId = conversation_id.into();
        let points = self
            .client
            .get_points(GetPoints {
                collection_name: self.collection_name.clone(),
                ids: vec![point_id],
                with_payload: Some(true.into()),
                with_vectors: Some(true.into()),
                ..Default::default()
            })
            .await?;

        if points.result.is_empty() {
            return Ok(None);
        }

        let point = &points.result[0];
        // Convert payload HashMap to JSON Value
        let json_value = serde_json::to_value(&point.payload)
            .context("Failed to serialize point payload")?;
        let conversation: Conversation = serde_json::from_value(json_value)
            .context("Failed to deserialize conversation")?;

        Ok(Some(conversation))
    }

    /// List all conversations (with pagination)
    pub async fn list_conversations(
        &self,
        limit: Option<usize>,
        offset: Option<usize>,
    ) -> Result<Vec<Conversation>> {
        let limit = limit.unwrap_or(100);
        let _offset = offset.unwrap_or(0); // Note: offset not yet used in ScrollPoints API

        // Use scroll with new API signature
        use qdrant_client::qdrant::ScrollPoints;
        
        let scroll_result = self
            .client
            .scroll(ScrollPoints {
                collection_name: self.collection_name.clone(),
                limit: Some(limit as u32),
                offset: None, // offset is not a u64, it's a PointId for pagination
                with_payload: Some(true.into()),
                with_vectors: Some(false.into()),
                filter: None,
                order_by: None,
                read_consistency: None,
                shard_key_selector: None,
                timeout: None,
            })
            .await?;

        let mut conversations = Vec::new();
        for point in scroll_result.result {
            let json_value = serde_json::to_value(&point.payload)
                .context("Failed to serialize point payload")?;
            if let Ok(conv) = serde_json::from_value(json_value) {
                conversations.push(conv);
            }
        }

        Ok(conversations)
    }
}

/// Main LLM client with conversation management
pub struct LlmClient {
    provider: Box<dyn LlmProviderTrait + Send + Sync>,
    storage: Option<Arc<QdrantStorage>>,
    conversations: Arc<Mutex<HashMap<String, Conversation>>>,
}

impl LlmClient {
    /// Create a new LLM client with the specified provider
    pub fn new(provider_type: LlmProvider, model: &str) -> Result<Self> {
        let provider: Box<dyn LlmProviderTrait + Send + Sync> = match provider_type {
            LlmProvider::OpenAI => Box::new(OpenAiClient::new(model)?),
            LlmProvider::Ollama => Box::new(OllamaClient::new(model)?),
        };

        Ok(Self {
            provider,
            storage: None,
            conversations: Arc::new(Mutex::new(HashMap::new())),
        })
    }

    /// Create a new LLM client with Qdrant storage
    pub async fn with_storage(
        provider_type: LlmProvider,
        model: &str,
        collection_name: Option<String>,
    ) -> Result<Self> {
        let provider: Box<dyn LlmProviderTrait + Send + Sync> = match provider_type {
            LlmProvider::OpenAI => Box::new(OpenAiClient::new(model)?),
            LlmProvider::Ollama => Box::new(OllamaClient::new(model)?),
        };

        let storage = Arc::new(QdrantStorage::new(collection_name).await?);

        Ok(Self {
            provider,
            storage: Some(storage),
            conversations: Arc::new(Mutex::new(HashMap::new())),
        })
    }

    /// Chat with a conversation ID (maintains history)
    pub fn chat_with_history(&self, conversation_id: Option<String>, user_message: &str) -> Result<String> {
        let conv_id = conversation_id.unwrap_or_else(|| Uuid::new_v4().to_string());
        
        // Get or create conversation
        let mut conversations = self.conversations.lock().unwrap();
        let conversation = conversations
            .entry(conv_id.clone())
            .or_insert_with(|| Conversation {
                id: conv_id.clone(),
                messages: Vec::new(),
                created_at: Utc::now(),
                updated_at: Utc::now(),
            });

        // Add user message
        conversation.messages.push(Message {
            role: "user".to_string(),
            content: user_message.to_string(),
            timestamp: Utc::now(),
        });
        conversation.updated_at = Utc::now();

        // Get response from LLM
        let reply = self.provider.chat(&conversation.messages)?;

        // Add assistant response
        conversation.messages.push(Message {
            role: "assistant".to_string(),
            content: reply.clone(),
            timestamp: Utc::now(),
        });
        conversation.updated_at = Utc::now();

        // Store in Qdrant if available
        // Note: This is called from spawn_blocking, so we use Handle::try_current()
        // to spawn async tasks from the blocking context
        if let Some(storage) = &self.storage {
            let conv_clone = conversation.clone();
            let storage_clone = storage.clone();
            // Try to get the current Tokio runtime handle
            if let Ok(handle) = Handle::try_current() {
                handle.spawn(async move {
                    let _ = storage_clone.store_conversation(&conv_clone).await;
                });
            } else {
                // If we can't get a handle, skip async storage (non-critical)
                // This can happen if called from a non-Tokio context
            }
        }

        Ok(reply)
    }

    /// Get conversation history
    pub fn get_conversation(&self, conversation_id: &str) -> Option<Conversation> {
        let conversations = self.conversations.lock().unwrap();
        conversations.get(conversation_id).cloned()
    }

    /// Load conversation from storage
    pub async fn load_conversation(&self, conversation_id: &str) -> Result<Option<Conversation>> {
        if let Some(storage) = &self.storage {
            if let Some(conv) = storage.get_conversation(conversation_id).await? {
                let mut conversations = self.conversations.lock().unwrap();
                conversations.insert(conversation_id.to_string(), conv.clone());
                return Ok(Some(conv));
            }
        }
        Ok(None)
    }

    /// Simple chat without history (backward compatibility)
    pub fn chat(&self, user_message: &str) -> Result<String> {
        let messages = vec![Message {
            role: "user".to_string(),
            content: user_message.to_string(),
            timestamp: Utc::now(),
        }];
        self.provider.chat(&messages)
    }
}

// Legacy compatibility: Create a simple wrapper that matches the old API
// Note: OpenAiClient already has a `new` method that returns OpenAiClient
// This is handled by the LlmClient::new method which creates the appropriate provider
