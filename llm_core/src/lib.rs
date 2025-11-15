use anyhow::{Context, Result};
use chrono::{DateTime, Utc};
use qdrant_client::{
    config::QdrantConfig,
    qdrant::{
        vectors_config::Config as QVectorsConfigEnum,
        CreateCollection, Distance, PointStruct,
        UpsertPoints, Value, VectorParams, VectorsConfig,
    },
    Qdrant,
};
use reqwest::blocking::{Client, ClientBuilder};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    env,
    sync::{Arc, Mutex},
    thread,
    time::Duration,
};
use tokio::runtime::Handle;
use uuid::Uuid;
use rand::{thread_rng, Rng};

/* ---------------------- Public types ---------------------- */

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum LlmProvider {
    OpenAI,
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

pub trait LlmProviderTrait {
    fn chat(&self, messages: &[Message]) -> Result<String>;
    fn provider_type(&self) -> LlmProvider;
}

/* ------------ OpenAI client with retries & quota handling ------------ */

pub struct OpenAiClient {
    api_key: String,
    org_id: Option<String>,
    client: std::sync::OnceLock<Client>,
    model: String,
    max_tokens: u16,
    max_retries: usize,
    backoff_ms: u64,
    timeout_secs: u64,
}

impl OpenAiClient {
    pub fn new(model: &str) -> Result<Self> {
        let api_key = env::var("OPENAI_API_KEY")
            .context("OPENAI_API_KEY must be set")?;
        Ok(Self {
            api_key,
            org_id: env::var("OPENAI_ORG_ID").ok(),
            client: std::sync::OnceLock::new(),
            model: model.to_string(),
            max_tokens: env::var("OPENAI_MAX_TOKENS")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(512),
            max_retries: env::var("OPENAI_MAX_RETRIES")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(5),
            backoff_ms: env::var("OPENAI_BACKOFF_MS")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(500),
            timeout_secs: env::var("OPENAI_TIMEOUT_SECS")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(60),
        })
    }

    fn get_client(&self) -> &Client {
        self.client.get_or_init(|| {
            ClientBuilder::new()
                .timeout(Duration::from_secs(self.timeout_secs))
                .build()
                .unwrap()
        })
    }

    fn backoff(&self, attempt: usize, retry_after_secs: Option<u64>) -> Duration {
        if let Some(secs) = retry_after_secs {
            return Duration::from_secs(secs.max(1));
        }
        let exp = (attempt as u32).min(16);
        let factor = 1u64 << exp;
        let base = self.backoff_ms.saturating_mul(factor);
        let jitter = thread_rng().gen_range(0..(self.backoff_ms / 2).max(1));
        Duration::from_millis(base + jitter)
    }
}

impl LlmProviderTrait for OpenAiClient {
    fn provider_type(&self) -> LlmProvider {
        LlmProvider::OpenAI
    }

    fn chat(&self, messages: &[Message]) -> Result<String> {
        #[derive(Serialize)]
        struct ApiMsg<'a> { role: &'a str, content: &'a str }
        #[derive(Serialize)]
        struct Req<'a> { model: &'a str, messages: Vec<ApiMsg<'a>>, max_tokens: u16 }
        #[derive(Deserialize)]
        struct Resp { choices: Vec<Choice> }
        #[derive(Deserialize)]
        struct Choice { message: RMsg }
        #[derive(Deserialize)]
        struct RMsg { content: String }

        let url = "https://api.openai.com/v1/chat/completions";
        let msgs: Vec<ApiMsg> = messages.iter().map(|m| ApiMsg { role: &m.role, content: &m.content }).collect();
        let body = Req { model: &self.model, messages: msgs, max_tokens: self.max_tokens };

        let mut last_err = None;

        for attempt in 0..=self.max_retries {
            let mut req = self.get_client()
                .post(url)
                .bearer_auth(&self.api_key)
                .json(&body);
            if let Some(org) = &self.org_id {
                req = req.header("OpenAI-Organization", org);
            }

            match req.send() {
                Ok(resp) => {
                    if resp.status().is_success() {
                        let r = resp.json::<Resp>()?;
                        return Ok(
                            r.choices.first()
                                .map(|c| c.message.content.clone())
                                .unwrap_or_else(|| "No response.".to_string())
                        );
                    }
                    let status = resp.status();
                    let retry_after = resp.headers()
                        .get("retry-after")
                        .and_then(|h| h.to_str().ok())
                        .and_then(|s| s.parse::<u64>().ok());
                    let txt = resp.text().unwrap_or_default();

                    if status.as_u16() == 429 && txt.contains("\"insufficient_quota\"") {
                        return Err(anyhow::anyhow!("OpenAI quota exceeded (insufficient_quota). Please update billing or use another provider."));
                    }

                    if status.as_u16() == 429 || status.is_server_error() {
                        last_err = Some(anyhow::anyhow!("OpenAI HTTP {}: {}", status, txt));
                        thread::sleep(self.backoff(attempt, retry_after));
                        continue;
                    }
                    return Err(anyhow::anyhow!("OpenAI HTTP {}: {}", status, txt));
                }
                Err(e) => {
                    last_err = Some(anyhow::anyhow!("OpenAI request error: {}", e));
                    thread::sleep(self.backoff(attempt, None));
                }
            }
        }
        Err(last_err.unwrap_or_else(|| anyhow::anyhow!("OpenAI retry exhausted")))
    }
}

/* ------------------ Ollama client ------------------ */

pub struct OllamaClient {
    client: std::sync::OnceLock<Client>,
    base_url: String,
    model: String,
}
impl OllamaClient {
    pub fn new(model: &str) -> Result<Self> {
        Ok(Self {
            client: std::sync::OnceLock::new(),
            base_url: env::var("OLLAMA_BASE_URL").unwrap_or_else(|_| "http://localhost:11434".to_string()),
            model: model.to_string(),
        })
    }
    fn get_client(&self) -> &Client {
        self.client.get_or_init(|| {
            ClientBuilder::new()
                .timeout(Duration::from_secs(120)) // 2 minutes timeout for model loading and inference
                .build()
                .expect("Failed to create HTTP client")
        })
    }
}
impl LlmProviderTrait for OllamaClient {
    fn provider_type(&self) -> LlmProvider { LlmProvider::Ollama }
    fn chat(&self, messages: &[Message]) -> Result<String> {
        #[derive(Serialize)]
        struct Req { model: String, messages: Vec<Msg>, stream: bool }
        #[derive(Serialize)]
        struct Msg { role: String, content: String }
        #[derive(Deserialize)]
        struct Resp { message: RMsg }
        #[derive(Deserialize)]
        struct RMsg { content: String }

        let url = format!("{}/api/chat", self.base_url);
        let msgs: Vec<Msg> = messages.iter().map(|m| Msg { role: m.role.clone(), content: m.content.clone() }).collect();
        let body = Req { model: self.model.clone(), messages: msgs, stream: false };
        let r = self.get_client().post(&url).json(&body).send()?.error_for_status()?.json::<Resp>()?;
        Ok(r.message.content)
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
        // rewrite REST port to gRPC port
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

/* ------------------ Main LLM client ------------------ */

pub struct LlmClient {
    provider: Box<dyn LlmProviderTrait + Send + Sync>,
    storage: Option<Arc<QdrantStorage>>,
    conversations: Arc<Mutex<HashMap<String, Conversation>>>,
}

impl LlmClient {
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

    pub async fn with_storage(provider_type: LlmProvider, model: &str, collection: Option<String>) -> Result<Self> {
        let provider: Box<dyn LlmProviderTrait + Send + Sync> = match provider_type {
            LlmProvider::OpenAI => Box::new(OpenAiClient::new(model)?),
            LlmProvider::Ollama => Box::new(OllamaClient::new(model)?),
        };
        let storage = Arc::new(QdrantStorage::new(collection).await?);
        Ok(Self {
            provider,
            storage: Some(storage),
            conversations: Arc::new(Mutex::new(HashMap::new())),
        })
    }

    fn tail(all: &[Message], n: usize) -> Vec<Message> {
        let len = all.len();
        let start = len.saturating_sub(n);
        all[start..].to_vec()
    }

    pub fn chat_with_history(&self, conversation_id: Option<String>, user_message: &str) -> Result<String> {
        let conv_id = conversation_id.unwrap_or_else(|| Uuid::new_v4().to_string());
        let mut convs = self.conversations.lock().unwrap();
        let convo = convs.entry(conv_id.clone()).or_insert_with(|| Conversation {
            id: conv_id.clone(),
            messages: Vec::new(),
            created_at: Utc::now(),
            updated_at: Utc::now(),
        });

        convo.messages.push(Message {
            role: "user".into(),
            content: user_message.into(),
            timestamp: Utc::now(),
        });
        convo.updated_at = Utc::now();

        // send only last 10 turns to the provider
        let compact = Self::tail(&convo.messages, 10);
        let reply = self.provider.chat(&compact)?;

        convo.messages.push(Message {
            role: "assistant".into(),
            content: reply.clone(),
            timestamp: Utc::now(),
        });
        convo.updated_at = Utc::now();

        if let Some(storage) = &self.storage {
            let conv_clone = convo.clone();
            let storage_clone = storage.clone();
            if let Ok(handle) = Handle::try_current() {
                handle.spawn(async move {
                    let _ = storage_clone.store_conversation(&conv_clone).await;
                });
            }
        }
        Ok(reply)
    }

    pub fn chat(&self, user_message: &str) -> Result<String> {
        let messages = vec![Message {
            role: "user".into(),
            content: user_message.into(),
            timestamp: Utc::now(),
        }];
        self.provider.chat(&messages)
    }
}
