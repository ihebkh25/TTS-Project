use base64::{engine::general_purpose, Engine as _};
use std::io::Write;

/// Encode PCM f32 samples as 16-bit PCM WAV (RIFF) and return Base64.
pub fn encode_wav_base64(samples: &[f32], sample_rate: u32) -> anyhow::Result<String> {
    // Convert f32 [-1.0,1.0] to i16
    let mut pcm_i16 = Vec::<i16>::with_capacity(samples.len());
    for &s in samples {
        let clamped = s.clamp(-1.0, 1.0);
        pcm_i16.push((clamped * i16::MAX as f32) as i16);
    }

    // WAV header fields
    let num_channels: u16 = 1;
    let bits_per_sample: u16 = 16;
    let byte_rate: u32 = sample_rate * num_channels as u32 * (bits_per_sample as u32 / 8);
    let block_align: u16 = num_channels * (bits_per_sample / 8);
    let data_size: u32 = (pcm_i16.len() * 2) as u32;
    let riff_size: u32 = 36 + data_size;

    let mut out = Vec::<u8>::with_capacity(44 + pcm_i16.len() * 2);

    // RIFF header
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&riff_size.to_le_bytes());
    out.extend_from_slice(b"WAVE");

    // fmt chunk
    out.extend_from_slice(b"fmt ");
    out.extend_from_slice(&16u32.to_le_bytes()); // fmt chunk size
    out.extend_from_slice(&1u16.to_le_bytes());  // PCM
    out.extend_from_slice(&num_channels.to_le_bytes());
    out.extend_from_slice(&sample_rate.to_le_bytes());
    out.extend_from_slice(&byte_rate.to_le_bytes());
    out.extend_from_slice(&block_align.to_le_bytes());
    out.extend_from_slice(&bits_per_sample.to_le_bytes());

    // data chunk
    out.extend_from_slice(b"data");
    out.extend_from_slice(&data_size.to_le_bytes());

    // PCM data
    let pcm_bytes = unsafe {
        std::slice::from_raw_parts(
            pcm_i16.as_ptr() as *const u8,
            pcm_i16.len() * std::mem::size_of::<i16>(),
        )
    };
    out.write_all(pcm_bytes)?;

    Ok(general_purpose::STANDARD.encode(out))
}
