use crate::error::ApiError;

/// Maximum text length for TTS requests
const MAX_TEXT_LENGTH: usize = 5000;
/// Minimum text length for TTS requests
const MIN_TEXT_LENGTH: usize = 1;

/// Validate TTS request
pub fn validate_tts_request(text: &str, language: Option<&str>) -> Result<(), ApiError> {
    // Validate text length
    if text.is_empty() {
        return Err(ApiError::InvalidInput("Text cannot be empty".to_string()));
    }
    if text.len() > MAX_TEXT_LENGTH {
        return Err(ApiError::InvalidInput(format!(
            "Text too long (max {} characters)",
            MAX_TEXT_LENGTH
        )));
    }
    if text.len() < MIN_TEXT_LENGTH {
        return Err(ApiError::InvalidInput(format!(
            "Text too short (min {} characters)",
            MIN_TEXT_LENGTH
        )));
    }

    // Validate language code format if provided
    if let Some(lang) = language {
        if !is_valid_language_code(lang) {
            return Err(ApiError::InvalidInput(format!(
                "Invalid language code format: {}. Expected format: ll_CC (e.g., en_US, de_DE)",
                lang
            )));
        }
    }

    Ok(())
}

/// Validate language code format (e.g., en_US, de_DE)
fn is_valid_language_code(code: &str) -> bool {
    // Language code should be in format: ll_CC (2 lowercase letters, underscore, 2 uppercase letters)
    // Or just ll (2 lowercase letters)
    let parts: Vec<&str> = code.split('_').collect();
    match parts.len() {
        1 => parts[0].len() == 2 && parts[0].chars().all(|c| c.is_ascii_lowercase()),
        2 => {
            parts[0].len() == 2
                && parts[0].chars().all(|c| c.is_ascii_lowercase())
                && parts[1].len() == 2
                && parts[1].chars().all(|c| c.is_ascii_uppercase())
        }
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_validate_tts_request_valid() {
        assert!(validate_tts_request("Hello", Some("de_DE")).is_ok());
        assert!(validate_tts_request("Test", None).is_ok());
    }

    #[test]
    fn test_validate_tts_request_empty_text() {
        let result = validate_tts_request("", Some("de_DE"));
        assert!(result.is_err());
        if let Err(ApiError::InvalidInput(msg)) = result {
            assert!(msg.contains("empty"));
        }
    }

    #[test]
    fn test_validate_tts_request_too_long() {
        let long_text = "a".repeat(6000);
        let result = validate_tts_request(&long_text, Some("de_DE"));
        assert!(result.is_err());
        if let Err(ApiError::InvalidInput(msg)) = result {
            assert!(msg.contains("too long"));
        }
    }

    #[test]
    fn test_validate_tts_request_invalid_language_code() {
        let result = validate_tts_request("Hello", Some("invalid"));
        assert!(result.is_err());
        
        let result = validate_tts_request("Hello", Some("INVALID"));
        assert!(result.is_err());
        
        let result = validate_tts_request("Hello", Some("en"));
        assert!(result.is_ok());
        
        let result = validate_tts_request("Hello", Some("en_US"));
        assert!(result.is_ok());
    }

}
