use anyhow::{Context, Result};
use chrono::{DateTime, Utc};
use qdrant_client::{
    prelude::*,
    qdrant::{
        point_id::PointIdOptions, vectors_config::Config, CreateCollection, Distance, PointStruct,
        VectorParams, VectorsConfig,
    },
};
use reqwest::blocking::Client;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::env;
use std::sync::{Arc, Mutex};
use uuid::Uuid;

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
    client: Client,
    model: String,
    max_tokens: u16,
}

impl OpenAiClient {
    /// Create a new OpenAI client
    pub fn new(model: &str) -> Result<Self> {
        let api_key = env::var("OPENAI_API_KEY")
            .context("OPENAI_API_KEY must be set in the environment")?;
        let max_tokens = env::var("OPENAI_MAX_TOKENS")
            .ok()
            .and_then(|v| v.parse::<u16>().ok())
            .unwrap_or(1000);
        Ok(Self {
            api_key,
            client: Client::new(),
            model: model.to_string(),
            max_tokens,
        })
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
            .client
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
    client: Client,
    base_url: String,
    model: String,
}

impl OllamaClient {
    /// Create a new Ollama client
    pub fn new(model: &str) -> Result<Self> {
        let base_url = env::var("OLLAMA_BASE_URL").unwrap_or_else(|_| "http://localhost:11434".to_string());
        Ok(Self {
            client: Client::new(),
            base_url,
            model: model.to_string(),
        })
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
            .client
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
    client: Arc<QdrantClient>,
    collection_name: String,
}

impl QdrantStorage {
    /// Create a new Qdrant storage client
    pub async fn new(collection_name: Option<String>) -> Result<Self> {
        let url = env::var("QDRANT_URL").unwrap_or_else(|_| "http://localhost:6333".to_string());
        let api_key = env::var("QDRANT_API_KEY").ok();
        
        let mut config = QdrantClientConfig::from_url(&url);
        if let Some(key) = api_key {
            config = config.with_api_key(&key);
        }

        let client = QdrantClient::new(Some(config))?;
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
            self.client
                .create_collection(&CreateCollection {
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
        let mut payload = HashMap::new();
        if let serde_json::Value::Object(map) = json_value {
            for (key, value) in map {
                payload.insert(key, value);
            }
        }

        // For now, use a zero vector (we can add embeddings later)
        let vector = vec![0.0; 1536];

        let point = PointStruct::new(
            conversation.id.clone(),
            vector,
            payload.into(),
        );

        self.client
            .upsert_points(self.collection_name.clone(), vec![point], None)
            .await
            .context("Failed to store conversation in Qdrant")?;

        Ok(())
    }

    /// Retrieve a conversation by ID
    pub async fn get_conversation(&self, conversation_id: &str) -> Result<Option<Conversation>> {
        let points = self
            .client
            .get_points(
                self.collection_name.clone(),
                &[conversation_id.into()],
                Some(true),
                Some(true),
            )
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
        let offset = offset.unwrap_or(0);

        let scroll_result = self
            .client
            .scroll_points(
                self.collection_name.clone(),
                Some(limit as u64),
                None,
                Some(offset as u64),
                None,
            )
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
        if let Some(storage) = &self.storage {
            // Note: This is a blocking call in async context
            // In production, you'd want to spawn a task or use async storage methods
            let conv_clone = conversation.clone();
            let storage_clone = storage.clone();
            std::thread::spawn(move || {
                let rt = tokio::runtime::Runtime::new().unwrap();
                rt.block_on(async {
                    let _ = storage_clone.store_conversation(&conv_clone).await;
                });
            });
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
impl OpenAiClient {
    /// Create a new OpenAI client (legacy compatibility)
    pub fn new(model: &str) -> Result<LlmClient> {
        LlmClient::new(LlmProvider::OpenAI, model)
    }
}
