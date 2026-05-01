import { TextToSpeechRequest, TextToSpeechResponse, MultimodalModel, MultimodalProvider } from '../types';

export class TextToSpeechClient {
  private provider: MultimodalProvider;
  private apiKey?: string;

  constructor(provider: MultimodalProvider, apiKey?: string) {
    this.provider = provider;
    this.apiKey = apiKey;
  }

  async synthesize(request: TextToSpeechRequest): Promise<TextToSpeechResponse> {
    try {
      if (this.provider === 'openrouter') {
        return await this.synthesizeWithOpenRouter(request);
      } else {
        return await this.synthesizeWithOllama(request);
      }
    } catch (error) {
      console.error('Speech synthesis error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to synthesize speech',
        provider: this.provider,
        model: request.model || 'tts-1',
      };
    }
  }

  private async synthesizeWithOpenRouter(request: TextToSpeechRequest): Promise<TextToSpeechResponse> {
    const { text, model, voice, format, speed } = request;
    const actualModel = model || 'tts-1';
    const actualFormat = format || 'mp3';

    // Для OpenRouter используем TTS API
    const response = await fetch('https://api.openrouter.ai/v1/audio/speech', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: actualModel,
        input: text,
        voice,
        response_format: actualFormat,
        speed,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      return {
        success: false,
        error: error.error?.message || 'OpenRouter TTS request failed',
        provider: this.provider,
        model: actualModel,
      };
    }

    const audioBlob = await response.blob();
    const audioBase64 = await this.blobToBase64(audioBlob);

    return {
      success: true,
      audio: audioBase64.split(',')[1], // Remove data URL prefix
      format: actualFormat,
      model: actualModel,
      provider: this.provider,
      duration: await this.getAudioDuration(audioBlob),
      cost: this.calculateCost(text.length, actualModel),
    };
  }

  private async synthesizeWithOllama(request: TextToSpeechRequest): Promise<TextToSpeechResponse> {
    // Ollama doesn't have built-in TTS, so we simulate it
    // In a real implementation, you would use a local TTS engine
    console.warn('Ollama TTS not implemented, using mock response');
    
    const actualModel = request.model || 'whisper-1';
    const actualFormat = request.format || 'wav';
    
    // Generate mock audio data
    const mockAudio = this.generateMockAudio(request.text);
    
    return {
      success: true,
      audio: mockAudio,
      format: actualFormat,
      model: actualModel,
      provider: this.provider,
      duration: request.text.length * 0.05, // Rough estimate
      cost: 0,
    };
  }

  private async blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  private async getAudioDuration(blob: Blob): Promise<number> {
    // Rough estimate: 150 characters per second of speech
    return new Promise((resolve) => {
      const audio = new Audio();
      audio.onloadedmetadata = () => {
        resolve(audio.duration || 0);
      };
      audio.onerror = () => resolve(0);
      audio.src = URL.createObjectURL(blob);
    });
  }

  private generateMockAudio(text: string): string {
    // Generate a simple WAV header and mock data
    const sampleRate = 22050;
    const bytesPerSample = 2;
    const channels = 1;
    const duration = text.length * 0.05; // 50ms per character
    const dataSize = Math.floor(sampleRate * duration * bytesPerSample * channels);
    
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);
    
    // WAV header
    this.writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    this.writeString(view, 8, 'WAVE');
    this.writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, channels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * channels * bytesPerSample, true);
    view.setUint16(32, channels * bytesPerSample, true);
    view.setUint16(34, bytesPerSample * 8, true);
    this.writeString(view, 36, 'data');
    view.setUint32(40, dataSize, true);
    
    // Generate simple sine wave
    for (let i = 0; i < dataSize / bytesPerSample; i++) {
      const value = Math.sin(2 * Math.PI * 440 * i / sampleRate) * 32767 * 0.5;
      view.setInt16(44 + i * bytesPerSample, value, true);
    }
    
    return btoa(String.fromCharCode(...new Uint8Array(buffer)));
  }

  private writeString(view: DataView, offset: number, string: string) {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  }

  private calculateCost(characters: number, model: string): number {
    // Rough cost estimates
    const costs: Record<string, number> = {
      'tts-1': 0.015 / 1000, // $0.015 per 1000 characters
      'tts-1-hd': 0.03 / 1000, // $0.03 per 1000 characters
    };
    
    return (costs[model] || 0.015 / 1000) * characters;
  }
}