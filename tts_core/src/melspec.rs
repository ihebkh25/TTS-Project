use base64::{engine::general_purpose, Engine as _};
use mel_spec::prelude::*; // Spectrogram, MelSpectrogram
use ndarray::Array1;
use num_complex::Complex;
use png::{BitDepth, ColorType, Encoder};

/// Compute mel-spectrogram frames for an audio buffer.
pub fn audio_to_mel(
    samples: &[f32],
    sample_rate_hz: f32,
    frame_size: usize,
    hop_size: usize,
    n_mels: usize,
) -> Vec<Vec<f64>> {
    let mut stft = Spectrogram::new(frame_size, hop_size);
    let mut mel = MelSpectrogram::new(frame_size, sample_rate_hz as f64, n_mels);

    let mut frames: Vec<Vec<f64>> = Vec::new();
    let mut offset = 0;
    while offset + hop_size <= samples.len() {
        let slice = &samples[offset..offset + hop_size];

        let mel_frame: Vec<f64> = if let Some(fft_frame) = stft.add(slice) {
            // STFT yields Complex<f64> in mel_spec
            let arr_f64: Array1<Complex<f64>> =
                Array1::from_iter(fft_frame.into_iter().map(|c: Complex<f64>| c));
            let (flat, _off) = mel.add(&arr_f64).into_raw_vec_and_offset();
            flat
        } else {
            vec![0.0f64; n_mels]
        };

        frames.push(mel_frame);
        offset += hop_size;
    }

    frames
}

/// Encode a mel-spectrogram (Vec<Vec<f64>>) into a grayscale PNG base64 string.
/// The mel is assumed as [time][mel_bin].
pub fn mel_to_png_base64(mel: &[Vec<f64>]) -> String {
    if mel.is_empty() {
        // Return a tiny 1x1 transparent pixel
        return general_purpose::STANDARD.encode([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,0,0,0,1,0,0,0,1,8,0,0,0,0,58,126,137,119,0,0,0,10,73,68,65,84,120,156,99,0,1,0,0,5,0,1,13,10,22,46,0,0,0,0,73,69,78,68,174,66,96,130])
    }

    let height = mel.len() as u32;
    let width  = mel[0].len() as u32;

    // Flatten and normalize to 0..=255
    let mut flat: Vec<f64> = mel.iter().flat_map(|row| row.iter().copied()).collect();
    let (mut min_v, mut max_v) = (f64::INFINITY, f64::NEG_INFINITY);
    for &v in &flat {
        if v < min_v { min_v = v; }
        if v > max_v { max_v = v; }
    }
    if (max_v - min_v).abs() < 1e-12 {
        // All zeros -> black image
        let png_bytes = encode_gray_png(width, height, &vec![0u8; (width * height) as usize]);
        return general_purpose::STANDARD.encode(png_bytes);
    }

    // Simple linear normalization; clamp to [0,255]
    let mut img: Vec<u8> = Vec::with_capacity(flat.len());
    for v in flat.drain(..) {
        let n = ((v - min_v) / (max_v - min_v)).clamp(0.0, 1.0);
        img.push((n * 255.0) as u8);
    }

    let png_bytes = encode_gray_png(width, height, &img);
    general_purpose::STANDARD.encode(png_bytes)
}

/// Helper: encode grayscale PNG (8-bit)
fn encode_gray_png(width: u32, height: u32, data: &[u8]) -> Vec<u8> {
    let mut buf = Vec::new();
    {
        let mut encoder = Encoder::new(&mut buf, width, height);
        encoder.set_color(ColorType::Grayscale);
        encoder.set_depth(BitDepth::Eight);
        let mut writer = encoder.write_header().expect("png header");
        writer.write_image_data(data).expect("png data");
    }
    buf
}

/// Legacy name from earlier code (kept in case you used it elsewhere).
pub fn encode_png_base64(buffer: &[u8]) -> String {
    general_purpose::STANDARD.encode(buffer)
}
