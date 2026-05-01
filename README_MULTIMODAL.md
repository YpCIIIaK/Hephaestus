# Multimodal AI Tools

Advanced AI-powered tools for document processing, image analysis, and audio generation built with Hephaestus framework.

## Overview

The multimodal module provides powerful AI capabilities for processing different types of media:

- **Document Analysis**: Extract text, summarize, classify, and answer questions from documents
- **Vision Analysis**: Analyze images, extract text, detect objects, and classify content
- **Text-to-Speech**: Convert text to natural-sounding speech with multiple voice options

## Features

### Document Analyzer
- Extract text from PDFs, Word documents, and images
- Summarize long documents
- Answer questions based on document content
- Classify documents into categories
- Preserve document structure and formatting

### Vision Analyzer
- Describe image content in natural language
- Extract text from images (OCR)
- Detect and classify objects
- Analyze complex scenes
- Generate detailed image descriptions

### Text-to-Speech
- Multiple voice options (Alloy, Echo, Fable, Onyx, Nova, Shimmer)
- Various output formats (MP3, WAV, FLAC, OGG)
- Adjustable speech speed
- High-quality audio generation

## API Endpoints

### Document Processing
- `POST /api/multimodal/document` - Process documents
- `GET /api/multimodal/document/health` - Health check

### Vision Processing
- `POST /api/multimodal/vision` - Analyze images
- `GET /api/multimodal/vision/health` - Health check

### Speech Generation
- `POST /api/multimodal/speech` - Generate speech
- `GET /api/multimodal/speech/health` - Health check

## Usage

### Document Analysis

```typescript
import { DocumentAnalyzer } from '@/components/multimodal/DocumentAnalyzer';

export default function Page() {
  return <DocumentAnalyzer />;
}
```

### Vision Analysis

```typescript
import { VisionAnalyzer } from '@/components/multimodal/VisionAnalyzer';

export default function Page() {
  return <VisionAnalyzer />;
}
```

### Text-to-Speech

```typescript
import { TTSAnalyzer } from '@/components/multimodal/TTSAnalyzer';

export default function Page() {
  return <TTSAnalyzer />;
}
```

## Providers

### OpenRouter
Supports models from OpenAI, Anthropic, Google, and other providers through OpenRouter.

### Ollama
Supports local models running via Ollama for privacy-focused deployments.

## Configuration

Set your OpenRouter API key in the environment:

```bash
OPENROUTER_API_KEY=your-api-key
```

## Benefits for Portfolio

1. **Modern AI Integration**: Demonstrates cutting-edge AI capabilities
2. **Full-Stack Development**: Shows both frontend and backend skills
3. **Type Safety**: Built with TypeScript for robust development
4. **Scalable Architecture**: Modular design allows easy extension
5. **Real-World Application**: Solves practical business problems

## Future Enhancements

- [ ] Video analysis capabilities
- [ ] Multi-language support
- [ ] Advanced document formatting preservation
- [ ] Custom model fine-tuning
- [ ] Batch processing support
- [ ] Advanced analytics dashboard

## License

MIT