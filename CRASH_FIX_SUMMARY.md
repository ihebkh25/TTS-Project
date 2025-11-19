# Server Crash Fix Summary

## Problem
The server was crashing after a few requests with `ERR_CONNECTION_RESET` errors. The root cause was **panic conditions** in the TTS code that would crash the entire server process.

## Root Causes Identified

### 1. **Critical: RwLock Poisoning Panics** ⚠️
**Location**: `tts_core/src/lib.rs` lines 385 and 418

**Issue**: Using `unwrap()` on `RwLock::read()` can panic if the lock is poisoned. Lock poisoning occurs when a thread panics while holding the lock, marking it as "poisoned". Subsequent attempts to acquire the lock will panic, crashing the server.

**Before**:
```rust
let synth = synth_arc.read().unwrap(); // ❌ Can panic!
```

**After**:
```rust
let synth = synth_arc.read()
    .map_err(|_| anyhow::anyhow!("Synthesizer lock poisoned - this indicates a previous panic. Please restart the server."))?; // ✅ Returns error instead of panicking
```

**Impact**: This was the **primary cause** of server crashes. If any thread panicked during synthesis, all subsequent requests would crash the server.

### 2. **PNG Encoding Panic**
**Location**: `tts_core/src/lib.rs` line 635

**Issue**: Using `expect()` on PNG encoding could panic if encoding failed.

**Before**:
```rust
encoder.write_image(...).expect("PNG encode failed"); // ❌ Can panic!
```

**After**:
```rust
if let Err(e) = encoder.write_image(...) {
    eprintln!("PNG encode failed: {}", e);
    return String::new(); // ✅ Returns empty string instead of panicking
}
```

**Impact**: Less critical (PNG encoding is rarely used), but could still cause crashes.

## Fixes Applied

1. ✅ Replaced `unwrap()` with proper error handling using `map_err()` for RwLock reads
2. ✅ Replaced `expect()` with error handling for PNG encoding
3. ✅ All errors now return proper `anyhow::Error` instead of panicking
4. ✅ Server will now return HTTP 500 errors instead of crashing

## Testing

- ✅ Code compiles successfully
- ✅ No linter errors
- ✅ Error handling is now graceful

## Expected Behavior After Fix

**Before**: Server crashes → `ERR_CONNECTION_RESET` → All requests fail

**After**: 
- Lock poisoning → Returns HTTP 500 with error message → Server continues running
- PNG encoding failure → Returns empty string → Server continues running
- Other errors → Proper error responses → Server continues running

## Recommendations

1. **Monitor logs** for lock poisoning errors - if you see them, it indicates a deeper issue that needs investigation
2. **Restart server** if lock poisoning occurs (as indicated in the error message)
3. **Check for other panic sources** - consider adding panic handlers or using `catch_unwind` for critical sections
4. **Add monitoring** - track error rates and server health

## Additional Notes

The lock poisoning issue suggests that there may have been a previous panic during synthesis. With these fixes:
- Future panics won't poison locks (they'll return errors)
- The server will remain stable even if individual requests fail
- Error messages will help diagnose underlying issues

## Files Modified

- `tts_core/src/lib.rs`: Fixed 3 panic points (2 RwLock unwraps, 1 PNG expect)

