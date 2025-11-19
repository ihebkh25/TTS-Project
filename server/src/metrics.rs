// Metrics collection and tracking

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use chrono::{DateTime, Utc};
use serde::Serialize;

/// Per-endpoint metrics
#[derive(Debug, Clone)]
pub struct EndpointMetrics {
    pub request_count: Arc<AtomicU64>,
    pub error_count: Arc<AtomicU64>,
    pub total_latency_ms: Arc<AtomicU64>,
    pub min_latency_ms: Arc<AtomicU64>,
    pub max_latency_ms: Arc<AtomicU64>,
    // For percentile calculation, we'll use a simple approach
    // In production, consider using a histogram library
    pub latency_samples: Arc<std::sync::Mutex<Vec<u64>>>,
}

impl EndpointMetrics {
    pub fn new() -> Self {
        Self {
            request_count: Arc::new(AtomicU64::new(0)),
            error_count: Arc::new(AtomicU64::new(0)),
            total_latency_ms: Arc::new(AtomicU64::new(0)),
            min_latency_ms: Arc::new(AtomicU64::new(u64::MAX)),
            max_latency_ms: Arc::new(AtomicU64::new(0)),
            latency_samples: Arc::new(std::sync::Mutex::new(Vec::new())),
        }
    }

    pub fn record_request(&self, latency_ms: u64) {
        self.request_count.fetch_add(1, Ordering::Relaxed);
        self.total_latency_ms.fetch_add(latency_ms, Ordering::Relaxed);
        
        // Update min/max
        let mut current_min = self.min_latency_ms.load(Ordering::Relaxed);
        while latency_ms < current_min && current_min != 0 {
            match self.min_latency_ms.compare_exchange_weak(
                current_min,
                latency_ms,
                Ordering::Relaxed,
                Ordering::Relaxed,
            ) {
                Ok(_) => break,
                Err(x) => current_min = x,
            }
        }
        
        let mut current_max = self.max_latency_ms.load(Ordering::Relaxed);
        while latency_ms > current_max {
            match self.max_latency_ms.compare_exchange_weak(
                current_max,
                latency_ms,
                Ordering::Relaxed,
                Ordering::Relaxed,
            ) {
                Ok(_) => break,
                Err(x) => current_max = x,
            }
        }
        
        // Store sample for percentile calculation (keep last 1000 samples)
        if let Ok(mut samples) = self.latency_samples.lock() {
            samples.push(latency_ms);
            if samples.len() > 1000 {
                samples.remove(0);
            }
        }
    }

    pub fn record_error(&self) {
        self.error_count.fetch_add(1, Ordering::Relaxed);
    }

    pub fn avg_latency_ms(&self) -> f64 {
        let count = self.request_count.load(Ordering::Relaxed);
        if count == 0 {
            return 0.0;
        }
        let total = self.total_latency_ms.load(Ordering::Relaxed);
        total as f64 / count as f64
    }

    pub fn p50_latency_ms(&self) -> u64 {
        self.percentile(50)
    }

    pub fn p95_latency_ms(&self) -> u64 {
        self.percentile(95)
    }

    pub fn p99_latency_ms(&self) -> u64 {
        self.percentile(99)
    }

    fn percentile(&self, p: u8) -> u64 {
        if let Ok(samples) = self.latency_samples.lock() {
            if samples.is_empty() {
                return 0;
            }
            let mut sorted = samples.clone();
            sorted.sort_unstable();
            let index = (sorted.len() * p as usize / 100).min(sorted.len() - 1);
            sorted[index]
        } else {
            0
        }
    }
}

impl Default for EndpointMetrics {
    fn default() -> Self {
        Self::new()
    }
}

/// TTS-specific metrics
#[derive(Debug, Clone)]
pub struct TtsMetrics {
    pub synthesis_count: Arc<AtomicU64>,
    pub total_synthesis_time_ms: Arc<AtomicU64>,
    pub cache_hits: Arc<AtomicU64>,
    pub cache_misses: Arc<AtomicU64>,
    pub total_samples: Arc<AtomicU64>,
}

impl TtsMetrics {
    pub fn new() -> Self {
        Self {
            synthesis_count: Arc::new(AtomicU64::new(0)),
            total_synthesis_time_ms: Arc::new(AtomicU64::new(0)),
            cache_hits: Arc::new(AtomicU64::new(0)),
            cache_misses: Arc::new(AtomicU64::new(0)),
            total_samples: Arc::new(AtomicU64::new(0)),
        }
    }

    pub fn record_synthesis(&self, time_ms: u64, samples: usize, cache_hit: bool) {
        self.synthesis_count.fetch_add(1, Ordering::Relaxed);
        self.total_synthesis_time_ms.fetch_add(time_ms, Ordering::Relaxed);
        self.total_samples.fetch_add(samples as u64, Ordering::Relaxed);
        if cache_hit {
            self.cache_hits.fetch_add(1, Ordering::Relaxed);
        } else {
            self.cache_misses.fetch_add(1, Ordering::Relaxed);
        }
    }

    pub fn avg_synthesis_time_ms(&self) -> f64 {
        let count = self.synthesis_count.load(Ordering::Relaxed);
        if count == 0 {
            return 0.0;
        }
        let total = self.total_synthesis_time_ms.load(Ordering::Relaxed);
        total as f64 / count as f64
    }

    pub fn cache_hit_rate(&self) -> f64 {
        let hits = self.cache_hits.load(Ordering::Relaxed);
        let misses = self.cache_misses.load(Ordering::Relaxed);
        let total = hits + misses;
        if total == 0 {
            return 0.0;
        }
        (hits as f64 / total as f64) * 100.0
    }
}

impl Default for TtsMetrics {
    fn default() -> Self {
        Self::new()
    }
}

/// Comprehensive metrics structure
#[derive(Debug, Clone)]
pub struct AppMetrics {
    pub tts: EndpointMetrics,
    pub tts_specific: TtsMetrics,
}

impl AppMetrics {
    pub fn new() -> Self {
        Self {
            tts: EndpointMetrics::new(),
            tts_specific: TtsMetrics::new(),
        }
    }
}

impl Default for AppMetrics {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Serialize)]
pub struct DetailedMetricsResponse {
    pub timestamp: DateTime<Utc>,
    pub system: SystemMetrics,
    pub endpoints: EndpointMetricsResponse,
    pub tts: TtsMetricsResponse,
}

#[derive(Serialize)]
pub struct SystemMetrics {
    pub cpu_usage_percent: f32,
    pub memory_used_mb: u64,
    pub memory_total_mb: u64,
    pub memory_usage_percent: f32,
    pub request_count: u64,
    pub uptime_seconds: u64,
    pub system_load: Option<f64>,
}

#[derive(Serialize)]
pub struct EndpointMetricsResponse {
    pub tts: EndpointStats,
}

#[derive(Serialize)]
pub struct EndpointStats {
    pub request_count: u64,
    pub error_count: u64,
    pub avg_latency_ms: f64,
    pub min_latency_ms: u64,
    pub max_latency_ms: u64,
    pub p50_latency_ms: u64,
    pub p95_latency_ms: u64,
    pub p99_latency_ms: u64,
}

#[derive(Serialize)]
pub struct TtsMetricsResponse {
    pub synthesis_count: u64,
    pub avg_synthesis_time_ms: f64,
    pub cache_hits: u64,
    pub cache_misses: u64,
    pub cache_hit_rate: f64,
    pub total_samples: u64,
}

