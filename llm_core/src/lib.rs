use anyhow::Result;
use reqwest::{blocking::Client, header};
use serde::{Deserialize, Serialize};
use std::env;

/// Structure for the OpenAI Chat API request
#[derive(Serialize)]
struct ChatRequest<'a> {
    model: &'a str,
    messages: Vec<Message<'a>>,
    max_tokens: u16,
}

#[derive(Serialize)]
struct Message<'a> {
    role: &'a str,
    content: &'a str,
}

/// Structure for the OpenAI Chat API response
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
    role: String,
    content: String,
}

pub struct OpenAiClient {
    api_key: String,
    client: Client,
    model: String,
}

impl OpenAiClient {
    /// Create a new client. Reads API key from the `OPENAI_API_KEY` env variable.
    pub fn new(model: &str) -> Result<Self> {
        let api_key = env::var("OPENAI_API_KEY")
            .expect("OPENAI_API_KEY must be set in the environment");
        let client = Client::new();
        Ok(Self {
            api_key,
            client,
            model: model.to_string(),
        })
    }

    /// Send a chat prompt and return the first response
    pub fn chat(&self, user_message: &str) -> Result<String> {
        let url = "https://api.openai.com/v1/chat/completions";
        let req_body = ChatRequest {
            model: &self.model,
            messages: vec![
                // System prompt (optional)
                Message { role: "system", content: "You are a helpful assistant." },
                // User prompt
                Message { role: "user", content: user_message },
            ],
            max_tokens: 200,
        };

        let response = self.client
            .post(url)
            .bearer_auth(&self.api_key)
            .json(&req_body)
            .send()?
            .error_for_status()?  // convert non-200 into error
            .json::<ChatResponse>()?;

        let reply = response
            .choices
            .first()
            .map(|choice| choice.message.content.clone())
            .unwrap_or_else(|| "No response.".to_string());
        Ok(reply)
    }
}
