import { FC, useState } from 'react';
import { VisionRequest, VisionResponse } from '@/lib/multimodal/types';

interface VisionAnalyzerProps {
  onAnalysisComplete?: (result: VisionResponse) => void;
}

export const VisionAnalyzer: FC<VisionAnalyzerProps> = ({ onAnalysisComplete }) => {
  const [image, setImage] = useState<string>('');
  const [preview, setPreview] = useState<string>('');
  const [task, setTask] = useState<VisionRequest['task']>('describe');
  const [model, setModel] = useState<VisionRequest['model']>('gpt-4o');
  const [prompt, setPrompt] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<VisionResponse | null>(null);
  const [provider, setProvider] = useState<'openrouter' | 'ollama'>('openrouter');

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64 = reader.result as string;
        setImage(base64);
        setPreview(base64);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleAnalyze = async () => {
    if (!image) {
      alert('Please upload an image first');
      return;
    }

    setLoading(true);
    try {
      const response = await fetch('/api/multimodal/vision', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          image,
          task,
          model,
          prompt,
          provider,
        }),
      });

      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'Analysis failed');
      }

      setResult(data);
      onAnalysisComplete?.(data);
    } catch (error) {
      console.error('Analysis error:', error);
      alert(error instanceof Error ? error.message : 'Analysis failed');
    } finally {
      setLoading(false);
    }
  };

  const formatResult = () => {
    if (!result) return null;

    return (
      <div className="mt-4 p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
        <h4 className="font-semibold text-gray-900 dark:text-white mb-2">
          Analysis Result
        </h4>
        
        {result.description && (
          <p className="text-gray-700 dark:text-gray-300 mb-3">
            {result.description}
          </p>
        )}

        {result.analysis?.text && (
          <div className="mb-3">
            <h5 className="font-medium text-gray-900 dark:text-white">
              Extracted Text:
            </h5>
            <pre className="bg-white dark:bg-gray-800 p-3 rounded text-sm">
              {result.analysis.text}
            </pre>
          </div>
        )}

        {result.analysis?.classification && (
          <div className="mb-3">
            <h5 className="font-medium text-gray-900 dark:text-white">
              Classification:
            </h5>
            <p className="text-gray-700 dark:text-gray-300">
              {result.analysis.classification}
            </p>
          </div>
        )}

        {result.analysis?.objects && result.analysis.objects.length > 0 && (
          <div className="mb-3">
            <h5 className="font-medium text-gray-900 dark:text-white">
              Detected Objects:
            </h5>
            <ul className="space-y-1">
              {result.analysis.objects.map((obj, i) => (
                <li key={i} className="text-sm text-gray-600 dark:text-gray-400">
                  {obj.label} ({Math.round(obj.confidence * 100)}%)
                </li>
              ))}
            </ul>
          </div>
        )}

        {result.tokens && (
          <div className="text-xs text-gray-500 dark:text-gray-400 mt-2">
            Tokens: {result.tokens.total} | 
            Cost: ${result.cost?.toFixed(4)} | 
            Provider: {result.provider}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Upload Image
          </label>
          <input
            type="file"
            accept="image/*"
            onChange={handleImageUpload}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 
                     rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white
                     focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Task
          </label>
          <select
            value={task}
            onChange={(e) => setTask(e.target.value as VisionRequest['task'])}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 
                     rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white
                     focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            <option value="describe">Describe</option>
            <option value="analyze">Analyze</option>
            <option value="extract-text">Extract Text</option>
            <option value="detect-objects">Detect Objects</option>
            <option value="classify">Classify</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Model
          </label>
          <select
            value={model}
            onChange={(e) => setModel(e.target.value as VisionRequest['model'])}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 
                     rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white
                     focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            <option value="gpt-4o">GPT-4o</option>
            <option value="gpt-4-vision-preview">GPT-4 Vision</option>
            <option value="claude-3-sonnet-20240229">Claude 3 Sonnet</option>
            <option value="claude-3-opus-20240229">Claude 3 Opus</option>
            <option value="llava:13b">LLaVA 13B (Ollama)</option>
            <option value="llava:34b">LLaVA 34B (Ollama)</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Provider
          </label>
          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value as 'openrouter' | 'ollama')}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 
                     rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white
                     focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            <option value="openrouter">OpenRouter</option>
            <option value="ollama">Ollama (Local)</option>
          </select>
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
          Custom Prompt (Optional)
        </label>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Enter custom prompt..."
          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 
                   rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white
                   focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          rows={3}
        />
      </div>

      {preview && (
        <div className="mb-4">
          <img 
            src={preview} 
            alt="Preview" 
            className="max-w-full h-auto rounded-lg border border-gray-200 dark:border-gray-700"
          />
        </div>
      )}

      <button
        onClick={handleAnalyze}
        disabled={loading || !image}
        className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg font-medium
                 hover:bg-blue-700 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2
                 disabled:opacity-50 disabled:cursor-not-allowed
                 transition-colors duration-200"
      >
        {loading ? 'Analyzing...' : 'Analyze Image'}
      </button>

      {formatResult()}
    </div>
  );
};