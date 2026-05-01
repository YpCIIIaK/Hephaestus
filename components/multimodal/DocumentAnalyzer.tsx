'use client';

import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, FileText, Download, Copy } from 'lucide-react';
import { DocumentRequest, DocumentResponse, DocumentTask, MultimodalModel } from '@/lib/multimodal/types';

interface DocumentAnalyzerProps {
  defaultProvider?: 'openrouter' | 'ollama';
}

export function DocumentAnalyzer({ defaultProvider = 'openrouter' }: DocumentAnalyzerProps) {
  const [document, setDocument] = useState<string>('');
  const [task, setTask] = useState<DocumentTask>('extract');
  const [model, setModel] = useState<MultimodalModel>('gpt-4');
  const [prompt, setPrompt] = useState<string>('');
  const [provider, setProvider] = useState<'openrouter' | 'ollama'>(defaultProvider);
  const [extractOptions, setExtractOptions] = useState({
    includeImages: false,
    includeTables: true,
    preserveStructure: true,
  });
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<DocumentResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const request: DocumentRequest = {
        document,
        task,
        model,
        prompt: prompt || undefined,
        provider,
        extractOptions,
      };

      const response = await fetch('/api/multimodal/document', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to process document');
      }

      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const base64 = event.target?.result as string;
        setDocument(base64);
      };
      reader.readAsDataURL(file);
    }
  };

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const downloadResult = () => {
    if (!result) return;
    
    let content = '';
    if (result.extractedText) content = result.extractedText;
    else if (result.summary) content = result.summary;
    else if (result.content) content = result.content;

    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = window.document.createElement('a');
    link.href = url;
    link.download = `document-${task}-${Date.now()}.txt`;
    window.document.body.appendChild(link);
    link.click();
    window.document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <Card className="w-full max-w-4xl mx-auto">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileText className="h-6 w-6" />
          Document Analyzer
        </CardTitle>
        <CardDescription>
          Extract text, summarize, classify, or answer questions about documents using AI
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Document Input */}
          <div className="space-y-2">
            <Label htmlFor="document">Document</Label>
            <Input
              id="document"
              type="file"
              accept=".pdf,.doc,.docx,.txt,.jpg,.jpeg,.png"
              onChange={handleFileUpload}
              disabled={loading}
            />
            {document && (
              <Alert>
                <AlertDescription>
                  Document loaded ({Math.round(document.length / 1024)} KB)
                </AlertDescription>
              </Alert>
            )}
          </div>

          {/* Task Selection */}
          <div className="space-y-2">
            <Label htmlFor="task">Task</Label>
            <Select
              value={task}
              onValueChange={(value) => setTask(value as DocumentTask)}
              disabled={loading}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="extract">Extract Text</SelectItem>
                <SelectItem value="summarize">Summarize</SelectItem>
                <SelectItem value="qa">Answer Questions</SelectItem>
                <SelectItem value="classify">Classify</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Model Selection */}
          <div className="space-y-2">
            <Label htmlFor="model">Model</Label>
            <Input
              id="model"
              value={model}
              onChange={(e) => setModel(e.target.value as MultimodalModel)}
              placeholder="e.g., gpt-4, claude-3, llama3"
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

          {/* Custom Prompt */}
          <div className="space-y-2">
            <Label htmlFor="prompt">Custom Prompt (optional)</Label>
            <Textarea
              id="prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Enter custom prompt..."
              disabled={loading}
              rows={3}
            />
          </div>

          {/* Extract Options */}
          {task === 'extract' && (
            <div className="space-y-4 p-4 border rounded-lg">
              <Label>Extract Options</Label>
              <div className="flex items-center justify-between">
                <Label htmlFor="includeImages" className="cursor-pointer">
                  Include Images
                </Label>
                <input
                  id="includeImages"
                  type="checkbox"
                  checked={extractOptions.includeImages}
                  onChange={(e) =>
                    setExtractOptions({
                      ...extractOptions,
                      includeImages: e.target.checked,
                    })
                  }
                  disabled={loading}
                />
              </div>
              <div className="flex items-center justify-between">
                <Label htmlFor="includeTables" className="cursor-pointer">
                  Include Tables
                </Label>
                <input
                  id="includeTables"
                  type="checkbox"
                  checked={extractOptions.includeTables}
                  onChange={(e) =>
                    setExtractOptions({
                      ...extractOptions,
                      includeTables: e.target.checked,
                    })
                  }
                  disabled={loading}
                />
              </div>
              <div className="flex items-center justify-between">
                <Label htmlFor="preserveStructure" className="cursor-pointer">
                  Preserve Structure
                </Label>
                <input
                  id="preserveStructure"
                  type="checkbox"
                  checked={extractOptions.preserveStructure}
                  onChange={(e) =>
                    setExtractOptions({
                      ...extractOptions,
                      preserveStructure: e.target.checked,
                    })
                  }
                  disabled={loading}
                />
              </div>
            </div>
          )}

          <Button type="submit" disabled={loading || !document} className="w-full">
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Processing...
              </>
            ) : (
              'Process Document'
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
                <span>Result</span>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => copyToClipboard(
                      result.extractedText || result.summary || result.content || ''
                    )}
                  >
                    <Copy className="h-4 w-4 mr-2" />
                    Copy
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={downloadResult}
                  >
                    <Download className="h-4 w-4 mr-2" />
                    Download
                  </Button>
                </div>
              </CardTitle>
              <CardDescription>
                Provider: {result.provider} | Model: {result.model}
                {result.tokens && (
                  <span> | Tokens: {result.tokens.total}</span>
                )}
                {result.cost && (
                  <span> | Cost: ${result.cost.toFixed(4)}</span>
                )}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {result.extractedText && (
                  <div>
                    <Label>Extracted Text</Label>
                    <pre className="mt-2 p-4 bg-muted rounded-lg whitespace-pre-wrap max-h-96 overflow-auto">
                      {result.extractedText}
                    </pre>
                  </div>
                )}
                {result.summary && (
                  <div>
                    <Label>Summary</Label>
                    <p className="mt-2 p-4 bg-muted rounded-lg">
                      {result.summary}
                    </p>
                  </div>
                )}
                {result.content && (
                  <div>
                    <Label>Content</Label>
                    <p className="mt-2 p-4 bg-muted rounded-lg">
                      {result.content}
                    </p>
                  </div>
                )}
                {result.structuredData?.sections && result.structuredData.sections.length > 0 && (
                  <div>
                    <Label>Document Structure</Label>
                    <div className="mt-2 space-y-2">
                      {result.structuredData.sections.map((section: { title: string; content: string; page: number }, index: number) => (
                        <div key={index} className="p-3 bg-muted rounded-lg">
                          <h4 className="font-semibold">{section.title}</h4>
                          <p className="text-sm text-muted-foreground mt-1">
                            Page {section.page}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}
      </CardContent>
    </Card>
  );
}