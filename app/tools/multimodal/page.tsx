import { DocumentAnalyzer } from '@/components/multimodal/DocumentAnalyzer';
import { VisionAnalyzer } from '@/components/multimodal/VisionAnalyzer';
import { TTSAnalyzer } from '@/components/multimodal/TTSAnalyzer';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

export const metadata = {
  title: 'Multimodal AI Tools - Hephaestus',
  description: 'Advanced AI tools for document analysis, vision, and text-to-speech',
};

export default function MultimodalToolsPage() {
  return (
    <div className="container mx-auto py-8 space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Multimodal AI Tools</h1>
        <p className="text-muted-foreground">
          Advanced AI-powered tools for document processing, image analysis, and audio generation
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>AI Tools Suite</CardTitle>
          <CardDescription>
            Select a tool to get started with advanced AI capabilities
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="document" className="w-full">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="document">Document Analyzer</TabsTrigger>
              <TabsTrigger value="vision">Vision Analyzer</TabsTrigger>
              <TabsTrigger value="tts">Text-to-Speech</TabsTrigger>
            </TabsList>
            <TabsContent value="document" className="mt-6">
              <DocumentAnalyzer />
            </TabsContent>
            <TabsContent value="vision" className="mt-6">
              <VisionAnalyzer />
            </TabsContent>
            <TabsContent value="tts" className="mt-6">
              <TTSAnalyzer />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}