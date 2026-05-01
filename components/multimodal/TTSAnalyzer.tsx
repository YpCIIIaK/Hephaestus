'use client';

import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, Play, Download, Copy } from 'lucide-react';
import { TextToSpeechRequest, TextToSpeechResponse, MultimodalModel } from '@/lib/multimodal/types';

interface TTSAnalyzerProps {
  defaultProvider?: 'openrouter' | 'ollama';
}

export function TTSAnalyzer({ defaultProvider = 'openrouter' }: TTSAnalyzerProps) {
  const [text, setText] = useState<string>('');
  const [model, setModel] = useState<MultimodalModel>('tts-1');
  const [voice, setVoice] = useState<'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer'>('alloy');
  const [format, setFormat] = useState<'mp3' | 'wav' | 'flac' | 'ogg'>('mp3');
  const [speed, setSpeed] = useState<number>(1.0);
  const [provider, setProvider] = useState<'openrouter' | 'ollama'>(defaultProvider);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<TextToSpeechResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const request: TextToSpeechRequest = {
        text,
        model,
        voice,
        format,
        speed,
        provider,
      };

      const response = await fetch('/api/multimodal/speech', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to generate speech');
      }

      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  const playAudio = () => {
    if (!result?.audio) return;
    
    const audio = new Audio(`data:audio/${result.format};base64,${result.audio}`);
    audio.play();
  };

  const downloadAudio = () => {
    if (!result?.audio) return;
    
    const link = document.createElement('a');
    link.href = `data:audio/${result.format};base64,${result.audio}`;
    link.download = `speech-${Date.now()}.${result.format}`;
    link.click();
  };

  return (
    <Card className="w-full max-w-4xl mx-auto">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Play className="h-6 w-6" />
          Text-to-Speech
        </CardTitle>
        <CardDescription>
          Convert text to natural-sounding speech using AI
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Text Input */}
          <div className="space-y-2">
            <Label htmlFor="text">Text</Label>
            <Textarea
              id="text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Enter text to convert to speech..."
              disabled={loading}
              rows={6}
            />
          </div>

          {/* Model Selection */}
          <div className="space-y-2">
            <Label htmlFor="model">Model</Label>
            <Select
              value={model}
              onValueChange={(value) => setModel(value as MultimodalModel)}
              disabled={loading}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="tts-1">TTS-1</SelectItem>
                <SelectItem value="tts-1-hd">TTS-1-HD</SelectItem>
                <SelectItem value="whisper-1">Whisper-1</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Voice Selection */}
          <div className="space-y-2">
            <Label htmlFor="voice">Voice</Label>
            <Select
              value={voice}
              onValueChange={(value) => setVoice(value as 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer')}
              disabled={loading}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="alloy">Alloy</SelectItem>
                <SelectItem value="echo">Echo</SelectItem>
                <SelectItem value="fable">Fable</SelectItem>
                <SelectItem value="onyx">Onyx</SelectItem>
                <SelectItem value="nova">Nova</SelectItem>
                <SelectItem value="shimmer">Shimmer</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Format Selection */}
          <div className="space-y-2">
            <Label htmlFor="format">Format</Label>
            <Select
              value={format}
              onValueChange={(value) => setFormat(value as 'mp3' | 'wav' | 'flac' | 'ogg')}
              disabled={loading}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="mp3">MP3</SelectItem>
                <SelectItem value="wav">WAV</SelectItem>
                <SelectItem value="flac">FLAC</SelectItem>
                <SelectItem value="ogg">OGG</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Speed Control */}
          <div className="space-y-2">
            <Label htmlFor="speed">Speed: {speed}x</Label>
            <Input
              id="speed"
              type="range"
              min="0.5"
              max="2.0"
              step="0.1"
              value={speed}
              onChange={(e) => setSpeed(parseFloat(e.target.value))}
              disabled={loading}
            />
          </div>

          {/* Provider Selection */}
          <div className="space-y-2">
            <Label htmlFor="provider">Provider</Label>
            <Select
              value={provider}
              onValueChange={(value) => setProvider(value as 'openrouter' | 'ollama')}
              disabled={loading}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="openrouter">OpenRouter</SelectItem>
                <SelectItem value="ollama">Ollama</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Button type="submit" disabled={loading || !text.trim()} className="w-full">
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Generating...
              </>
            ) : (
              'Generate Speech'
            )}
          </Button>
        </form>

        {/* Error Display */}
        {error && (
          <Alert variant="destructive" className="mt-6">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* Result Display */}
        {result && (
          <Card className="mt-6">
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span>Generated Audio</span>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={playAudio}
                  >
                    <Play className="h-4 w-4 mr-2" />
                    Play
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={downloadAudio}
                  >
                    <Download className="h-4 w-4 mr-2" />
                    Download
                  </Button>
                </div>
              </CardTitle>
              <CardDescription>
                Model: {result.model} | Format: {result.format}
                {result.duration && (
                  <span> | Duration: {result.duration.toFixed(1)}s</span>
                )}
                {result.cost && (
                  <span> | Cost: ${result.cost.toFixed(4)}</span>
                )}
              </CardDescription>
            </CardHeader>
          </Card>
        )}
      </CardContent>
    </Card>
  );
}