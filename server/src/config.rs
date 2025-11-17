// Configuration constants for the server

use std::time::Duration;

#[derive(Clone)]
pub struct ServerConfig {
    pub port: u16,
    pub rate_limit_per_minute: u32,
    pub llm_timeout_secs: u64,
    pub request_timeout_secs: u64,
    pub cors_allowed_origins: Option<Vec<String>>,
}

impl Default for ServerConfig {
    fn default() -> Self {
        Self {
            port: 8085,
            rate_limit_per_minute: 60,
            llm_timeout_secs: 120,
            request_timeout_secs: 60,
            cors_allowed_origins: None,
        }
    }
}

impl ServerConfig {
    pub fn from_env() -> Self {
        let port = std::env::var("PORT")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(8085);
        
        let rate_limit_per_minute = std::env::var("RATE_LIMIT_PER_MINUTE")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(60);
        
        let llm_timeout_secs = std::env::var("LLM_TIMEOUT_SECS")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(120);
        
        let request_timeout_secs = std::env::var("REQUEST_TIMEOUT_SECS")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(60);
        
        let cors_allowed_origins = std::env::var("CORS_ALLOWED_ORIGINS")
            .ok()
            .map(|origins| {
                origins
                    .split(',')
                    .map(|s| s.trim().to_string())
                    .collect()
            });
        
        Self {
            port,
            rate_limit_per_minute,
            llm_timeout_secs,
            request_timeout_secs,
            cors_allowed_origins,
        }
    }
    
    pub fn request_timeout(&self) -> Duration {
        Duration::from_secs(self.request_timeout_secs)
    }
    
    pub fn llm_timeout(&self) -> Duration {
        Duration::from_secs(self.llm_timeout_secs)
    }
}

