#!/usr/bin/env python3
"""
TTS Bridge - Python script for pocket-tts Node.js integration
Communicates via JSON over stdin/stdout
"""

import sys
import json
import base64
import io
import os

# Disable unnecessary logging during import
os.environ['TF_CPP_MIN_LOG_LEVEL'] = '3'

def send_response(response):
    """Send JSON response to stdout"""
    print(json.dumps(response), flush=True)

def check_setup():
    """Check if pocket-tts and dependencies are properly installed"""
    result = {
        "pythonInstalled": True,
        "pythonVersion": sys.version.split()[0],
        "pocketTtsInstalled": False,
        "voiceCloningAvailable": False,
        "huggingFaceLoggedIn": False,
        "setupComplete": False
    }
    
    # Check pocket-tts
    try:
        from pocket_tts import TTSModel
        result["pocketTtsInstalled"] = True
    except ImportError:
        return result
    
    # Check HuggingFace login
    try:
        from huggingface_hub import HfApi
        api = HfApi()
        result["huggingFaceLoggedIn"] = api.token is not None
    except:
        pass
    
    # Check if model can load (including voice cloning)
    try:
        model = TTSModel.load_model()
        result["voiceCloningAvailable"] = getattr(model, 'has_voice_cloning', False)
        result["setupComplete"] = True
        # Don't keep model in memory for check
        del model
    except Exception as e:
        # Model loading failed but pocket-tts is installed
        # Predefined voices might still work
        result["setupComplete"] = True
    
    return result

class TTSBridge:
    def __init__(self):
        self.model = None
        self.voice_cache = {}
        self.sample_rate = 24000
    
    def init_model(self):
        """Initialize the TTS model"""
        if self.model is not None:
            return True
        
        try:
            from pocket_tts import TTSModel
            self.model = TTSModel.load_model()
            self.sample_rate = self.model.sample_rate
            return True
        except Exception as e:
            raise Exception(f"Failed to load TTS model: {str(e)}")
    
    def load_voice(self, voice):
        """Load and cache a voice"""
        if voice in self.voice_cache:
            return True
        
        if self.model is None:
            self.init_model()
        
        try:
            voice_state = self.model.get_state_for_audio_prompt(voice)
            self.voice_cache[voice] = voice_state
            return True
        except ValueError as e:
            if "voice cloning" in str(e).lower():
                raise Exception(
                    "Voice cloning not available. "
                    "Accept terms at https://huggingface.co/kyutai/pocket-tts "
                    "and login with: uvx hf auth login"
                )
            raise
    
    def generate(self, text, voice="alba"):
        """Generate audio from text"""
        if self.model is None:
            self.init_model()
        
        # Load voice if not cached
        if voice not in self.voice_cache:
            self.load_voice(voice)
        
        voice_state = self.voice_cache[voice]
        
        # Generate audio
        audio = self.model.generate_audio(voice_state, text)
        
        # Convert to WAV bytes
        import scipy.io.wavfile
        buffer = io.BytesIO()
        scipy.io.wavfile.write(buffer, self.sample_rate, audio.numpy())
        buffer.seek(0)
        
        # Return as base64
        return base64.b64encode(buffer.read()).decode('utf-8')
    
    def list_voices(self):
        """List available predefined voices"""
        return ['alba', 'marius', 'javert', 'jean', 'fantine', 'cosette', 'eponine', 'azelma']

def main():
    bridge = TTSBridge()
    
    # Send ready signal
    send_response({"status": "ready"})
    
    # Process commands from stdin
    for line in sys.stdin:
        try:
            command = json.loads(line.strip())
            cmd = command.get('cmd')
            request_id = command.get('id')
            
            response = {"id": request_id}
            
            if cmd == 'check_setup':
                response["status"] = "ok"
                response["data"] = check_setup()
            
            elif cmd == 'init':
                bridge.init_model()
                response["status"] = "ok"
            
            elif cmd == 'load_voice':
                voice = command.get('voice', 'alba')
                bridge.load_voice(voice)
                response["status"] = "ok"
            
            elif cmd == 'generate':
                text = command.get('text', '')
                voice = command.get('voice', 'alba')
                audio_b64 = bridge.generate(text, voice)
                response["status"] = "ok"
                response["audio"] = audio_b64
            
            elif cmd == 'list_voices':
                response["status"] = "ok"
                response["data"] = {"voices": bridge.list_voices()}
            
            elif cmd == 'shutdown':
                send_response({"id": request_id, "status": "ok"})
                break
            
            else:
                response["status"] = "error"
                response["message"] = f"Unknown command: {cmd}"
            
            send_response(response)
        
        except json.JSONDecodeError:
            send_response({"status": "error", "message": "Invalid JSON"})
        
        except Exception as e:
            send_response({
                "id": command.get('id') if 'command' in dir() else None,
                "status": "error",
                "message": str(e)
            })

if __name__ == "__main__":
    main()
