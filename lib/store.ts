import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { Model, ArenaNode, ArenaEdge, ChatMessage, ModelResponse, ArenaConfig, HistoricalChat, NodeStatus, UsageEvent } from './types'
import { getTokenCount } from './tokenizer'

interface ArenaStore {
  // Models
  models: Model[]
  addModel: (model: Model) => void
  updateModel: (id: string, updates: Partial<Model>) => void
  removeModel: (id: string) => void
  
  // Arena nodes and edges
  nodes: ArenaNode[]
  edges: ArenaEdge[]
  addNode: (node: ArenaNode) => void
  updateNode: (id: string, updates: Partial<ArenaNode>) => void
  updateNodeData: (id: string, dataUpdates: Partial<ArenaNode['data']>) => void
  removeNode: (id: string) => void
  addEdge: (edge: ArenaEdge) => void
  removeEdge: (id: string) => void
  
  // Chat
  messages: ChatMessage[]
  responses: ModelResponse[]
  addMessage: (message: ChatMessage) => void
  addResponse: (response: ModelResponse) => void
  updateResponse: (id: string, updates: Partial<ModelResponse>) => void
  removeResponse: (id: string) => void
  clearChat: () => void
  
  // Arena configs
  configs: ArenaConfig[]
  activeConfigId: string | null
  saveConfig: (config: ArenaConfig) => void
  loadConfig: (id: string) => void
  deleteConfig: (id: string) => void
  
  // UI state
  activeTab: 'chat' | 'arena' | 'dashboard'
  setActiveTab: (tab: 'chat' | 'arena' | 'dashboard') => void
  selectedNodeId: string | null
  setSelectedNodeId: (id: string | null) => void
  isSidebarOpen: boolean
  setSidebarOpen: (open: boolean) => void

  // Chat History
  currentChatId: string | null
  historicalChats: HistoricalChat[]
  loadHistoricalChat: (id: string) => void
  deleteHistoricalChat: (id: string) => void
  startNewChat: () => void
  
  // Stats
  globalUsage: {
    totalTokens: number
    totalCost: number
    totalRequests: number
  }
  usageHistory: UsageEvent[]
  
  // Budget Control
  sessionCost: number
  maxSessionBudget: number
  setMaxSessionBudget: (limit: number) => void
  resetSessionCost: () => void
  
  // Chat Configuration
  chatMode: string
  setChatMode: (mode: string) => void
  
  // Execution Control
  activeAbortController: AbortController | null
  abortGeneration: () => void
  setAbortController: (ac: AbortController | null) => void
  
  // Message Queue
  messageQueue: string[]
  enqueueMessage: (content: string) => void
  dequeueMessage: () => string | null

  // Chat Input Draft
  chatInput: string
  setChatInput: (input: string) => void

  // Knowledge Base
  knowledgeBase: string[]
  addKnowledgeFile: (path: string) => void
  removeKnowledgeFile: (path: string) => void
  toggleNodeGlobal: (nodeId: string, isGlobal: boolean) => void
}

const defaultModels: Model[] = [
  {
    id: 'openai/o3-mini',
    name: 'GPT-4',
    provider: 'openai',
    description: 'Most capable OpenAI model',
    enabled: true,
    level: 1,
    temperature: 0.7,
    maxTokens: 4096,
  },
  {
    id: 'anthropic/claude-3.5-sonnet',
    name: 'Claude 3 Opus',
    provider: 'anthropic',
    description: 'Most capable Anthropic model',
    enabled: true,
    level: 1,
    temperature: 0.7,
    maxTokens: 4096,
  },
  {
    id: 'google/gemini-2.5-pro',
    name: 'Gemini Pro',
    provider: 'google',
    description: 'Google\'s advanced model',
    enabled: true,
    level: 1,
    temperature: 0.7,
    maxTokens: 4096,
  },
  {
    id: 'meta-llama/llama-3.1-70b-instruct',
    name: 'Llama 3 70B',
    provider: 'meta',
    description: 'Meta\'s open-source model',
    enabled: true,
    level: 2,
    temperature: 0.7,
    maxTokens: 4096,
  },
]

const defaultNodes: ArenaNode[] = []

const defaultEdges: ArenaEdge[] = []

export const useArenaStore = create<ArenaStore>()(
  persist(
    (set, get) => ({
  // Models
  models: defaultModels,
  addModel: (model) => set((state) => ({ models: [...state.models, model] })),
  updateModel: (id, updates) => set((state) => ({
    models: state.models.map((m) => (m.id === id ? { ...m, ...updates } : m)),
  })),
  removeModel: (id) => set((state) => ({
    models: state.models.filter((m) => m.id !== id),
  })),
  
  // Arena nodes and edges
  nodes: defaultNodes,
  edges: defaultEdges,
  addNode: (node) => set((state) => ({ nodes: [...state.nodes, node] })),
  updateNode: (id, updates) => set((state) => ({
    nodes: state.nodes.map((n) => (n.id === id ? { ...n, ...updates } : n)),
  })),
  updateNodeData: (id, dataUpdates) => set((state) => {
    const newNodes = state.nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...dataUpdates } } : n));
    
    // Sync Knowledge Base based on ALL global nodes + existing manually added files
    const globalNodePaths = newNodes
      .filter(n => n.type === 'file' && n.data.isGlobal && n.data.filePath)
      .map(n => (n.data.filePath as string).replace(/\\/g, '/'));

    // Keep manually added files that are NOT from nodes (or just keep all and Deduplicate)
    const newKB = Array.from(new Set([...state.knowledgeBase.map(p => p.replace(/\\/g, '/')), ...globalNodePaths]));
    
    // If we just turned OFF global on a node, specifically remove its path 
    // IF no other node is also globally broadcasting it
    if (dataUpdates.isGlobal === false) {
      const node = state.nodes.find(n => n.id === id);
      const pathToRemove = node?.data.filePath;
      if (pathToRemove && !globalNodePaths.includes(pathToRemove)) {
        const index = newKB.indexOf(pathToRemove);
        if (index > -1) newKB.splice(index, 1);
      }
    }

    if (state.activeConfigId) {
       const config = state.configs.find(c => c.id === state.activeConfigId);
       if (config) {
         get().saveConfig({ ...config, knowledgeBase: newKB, nodes: newNodes, edges: state.edges });
       }
    }

    return { nodes: newNodes, knowledgeBase: newKB };
  }),
  removeNode: (id) => set((state) => ({
    nodes: state.nodes.filter((n) => n.id !== id),
    edges: state.edges.filter((e) => e.source !== id && e.target !== id),
  })),
  addEdge: (edge) => set((state) => ({ edges: [...state.edges, edge] })),
  removeEdge: (id) => set((state) => ({
    edges: state.edges.filter((e) => e.id !== id),
  })),
  
  // Chat
  messages: [],
  responses: [],
  currentChatId: null,
  addMessage: (message) => set((state) => {
    let newChatId = state.currentChatId;
    let newChats = [...state.historicalChats];
    const newMessages = [...state.messages, message];
    
    if (!newChatId) {
      newChatId = Date.now().toString();
      const title = message.content.length > 30 ? message.content.slice(0, 30) + '...' : message.content;
      newChats.unshift({
        id: newChatId,
        title,
        messages: newMessages,
        responses: [...state.responses],
        date: new Date().toISOString()
      });
    } else {
      newChats = newChats.map((c) => c.id === newChatId ? { ...c, messages: newMessages } : c);
    }
    
    return { messages: newMessages, currentChatId: newChatId, historicalChats: newChats };
  }),
  addResponse: (response) => set((state) => {
    const newResponses = [...state.responses, response];
    return {
      responses: newResponses,
      globalUsage: {
        ...state.globalUsage,
        totalRequests: state.globalUsage.totalRequests + 1
      },
      historicalChats: state.currentChatId
        ? state.historicalChats.map(c => c.id === state.currentChatId ? { ...c, responses: newResponses } : c)
        : state.historicalChats
    };
  }),
  updateResponse: (id, updates) => set((state) => {
    const originalResponse = state.responses.find(r => r.id === id)
    
    // Stats update: detect newly completed steps for pipelines
    let globalUsage = state.globalUsage;
    let usageHistory = state.usageHistory;
    const billedNodeIds = originalResponse?.billedNodeIds || [];
    const newBilledNodeIds = [...billedNodeIds];

    // 1. Incremental Billing for Pipeline Steps
    if (updates.pipelineSteps) {
      updates.pipelineSteps.forEach(step => {
        const wasCompleted = originalResponse?.pipelineSteps?.find(s => s.nodeId === step.nodeId)?.status === 'completed';
        const wasError = originalResponse?.pipelineSteps?.find(s => s.nodeId === step.nodeId)?.status === 'error';
        const isNowCompleted = step.status === 'completed';
        const isNowError = step.status === 'error';
        
        // Bill completed steps
        if (isNowCompleted && !wasCompleted && !newBilledNodeIds.includes(step.nodeId)) {
          const config = state.configs.find(c => c.id === state.activeConfigId);
          const node = config?.nodes.find(n => n.id === step.nodeId);
          const model = node?.data.model;

          const hasSplitTokens =
            typeof step.promptTokens === 'number' && typeof step.completionTokens === 'number'

          const promptTokens = hasSplitTokens ? (step.promptTokens as number) : undefined
          const completionTokens = hasSplitTokens ? (step.completionTokens as number) : undefined

          // Prefer accurate prompt/completion token split (from the executor),
          // but keep a safe fallback for older persisted runs.
          const totalTokens = hasSplitTokens
            ? (promptTokens as number) + (completionTokens as number)
            : getTokenCount(step.result || '', model?.id)

          if (totalTokens > 0) {
            let cost = 0
            if (hasSplitTokens && typeof step.promptCost === 'number' && typeof step.completionCost === 'number') {
              cost = (step.promptCost as number) + (step.completionCost as number)
            } else if (hasSplitTokens && model?.pricing && typeof promptTokens === 'number' && typeof completionTokens === 'number') {
              cost =
                (promptTokens * model.pricing.prompt) +
                (completionTokens * model.pricing.completion) +
                model.pricing.request
            } else {
              // Heuristic fallback (matches current behaviour)
              cost = (totalTokens / 1000) * 0.002
            }

            globalUsage = {
              totalTokens: globalUsage.totalTokens + totalTokens,
              totalCost: globalUsage.totalCost + cost,
              totalRequests: globalUsage.totalRequests,
            };

            usageHistory = [
              ...usageHistory,
              {
                id: `${id}-${step.nodeId}-${Date.now()}`,
                timestamp: new Date().toISOString(),
                modelId: model?.id || `arena:${step.type}`,
                modelName: model?.name || (step.type.charAt(0).toUpperCase() + step.type.slice(1) + ' Node'),
                tokens: totalTokens,
                cost,
                type: 'pipeline'
              }
            ];
            newBilledNodeIds.push(step.nodeId);
          }
        }
        
        // Record errors in history (for analytics)
        if (isNowError && !wasError && !wasCompleted) {
          const config = state.configs.find(c => c.id === state.activeConfigId);
          const node = config?.nodes.find(n => n.id === step.nodeId);
          const model = node?.data.model;
          
          usageHistory = [
            ...usageHistory,
            {
              id: `${id}-${step.nodeId}-${Date.now()}`,
              timestamp: new Date().toISOString(),
              modelId: model?.id || `arena:${step.type}`,
              modelName: model?.name || (step.type.charAt(0).toUpperCase() + step.type.slice(1) + ' Node'),
              tokens: 0,
              cost: 0,
              type: 'error'
            }
          ];
        }
      });
    }

    // 2. Final Completion Billing (For Chat OR Final Pipeline Counter)
    if (updates.status === 'complete' && originalResponse?.status !== 'complete') {
      const isPipeline = (updates.pipelineSteps?.length || originalResponse?.pipelineSteps?.length || 0) > 0;
      
      if (!isPipeline) {
        const tokens = updates.tokens || originalResponse?.tokens || 0;
        const modelId = updates.modelId || originalResponse?.modelId;
        const model = state.models.find(m => m.id === modelId);
        
        let cost = (tokens / 1000) * 0.002;
        if (model?.pricing) {
          const promptTokens = Math.ceil(tokens * 0.4);
          const completionTokens = tokens - promptTokens;
          cost = (promptTokens * model.pricing.prompt) + (completionTokens * model.pricing.completion) + model.pricing.request;
        }
        
        globalUsage = {
          totalTokens: globalUsage.totalTokens + tokens,
          totalCost: globalUsage.totalCost + cost,
          totalRequests: globalUsage.totalRequests,
        };

        usageHistory = [
          ...usageHistory,
          {
            id: `${id}-${Date.now()}`,
            timestamp: new Date().toISOString(),
            modelId: modelId || 'unknown',
            modelName: updates.modelName || originalResponse?.modelName || 'Unknown Model',
            tokens,
            cost,
            type: 'chat'
          }
        ];
      } else {
        // We already incremented total requests in addResponse
        globalUsage = { ...globalUsage };
      }
    }

    const finalUpdates = { ...updates, billedNodeIds: newBilledNodeIds };
    const newResponses = state.responses.map((r) => r.id === id ? { ...r, ...finalUpdates } : r);
    
    // Sync history
    const isTerminal = updates.status === 'complete' || updates.status === 'error'
    const isCollapseToggle = 'isCollapsed' in updates || 'collapsedStepIds' in updates
    
    return {
      responses: newResponses,
      globalUsage,
      sessionCost: state.sessionCost + (globalUsage.totalCost - state.globalUsage.totalCost), // Increment session cost by same delta
      historicalChats: ((isTerminal || isCollapseToggle) && state.currentChatId)
        ? state.historicalChats.map(c => c.id === state.currentChatId ? { ...c, responses: newResponses } : c)
        : state.historicalChats,
      usageHistory
    };
  }),
  removeResponse: (id) => set((state) => {
    const newResponses = state.responses.filter((r) => r.id !== id);
    return {
      responses: newResponses,
      historicalChats: state.currentChatId
        ? state.historicalChats.map(c => c.id === state.currentChatId ? { ...c, responses: newResponses } : c)
        : state.historicalChats
    };
  }),
  clearChat: () => set({ messages: [], responses: [], currentChatId: null }),
  
  // Arena configs
  configs: [],
  activeConfigId: null,
  saveConfig: (config) => set((state) => ({
    configs: state.configs.some((c) => c.id === config.id)
      ? state.configs.map((c) => (c.id === config.id ? config : c))
      : [...state.configs, config],
  })),
  loadConfig: (id) => {
    const config = get().configs.find((c) => c.id === id)
    if (config) {
      set({
        nodes: config.nodes,
        edges: config.edges,
        activeConfigId: id,
        chatMode: `pipeline:${id}`,
        knowledgeBase: config.knowledgeBase || []
      })
    }
  },
  deleteConfig: (id) => set((state) => ({
    configs: state.configs.filter((c) => c.id !== id),
    activeConfigId: state.activeConfigId === id ? null : state.activeConfigId,
    chatMode: state.chatMode === `pipeline:${id}` ? 'models' : state.chatMode
  })),
  
  activeTab: 'chat',
  setActiveTab: (tab) => set({ activeTab: tab }),
  selectedNodeId: null,
  setSelectedNodeId: (id) => set({ selectedNodeId: id }),
  isSidebarOpen: false,
  setSidebarOpen: (open) => set({ isSidebarOpen: open }),

  // Chat History
  historicalChats: [],
  loadHistoricalChat: (id) => set((state) => {
    const chat = state.historicalChats.find(c => c.id === id);
    if (chat) {
      return { currentChatId: id, messages: [...chat.messages], responses: [...chat.responses], activeTab: 'chat' };
    }
    return state;
  }),
  deleteHistoricalChat: (id) => set((state) => ({
    historicalChats: state.historicalChats.filter(c => c.id !== id),
    ...(state.currentChatId === id ? { currentChatId: null, messages: [], responses: [] } : {})
  })),
  startNewChat: () => set({ currentChatId: null, messages: [], responses: [] }),

  // Knowledge Base
  knowledgeBase: [],
  addKnowledgeFile: (path) => set((state) => {
    const normalized = path.replace(/\\/g, '/')
    const newKB = Array.from(new Set([...state.knowledgeBase.map(p => p.replace(/\\/g, '/')), normalized]));
    if (state.activeConfigId) {
      const config = state.configs.find(c => c.id === state.activeConfigId);
      if (config) {
        get().saveConfig({ ...config, knowledgeBase: newKB, nodes: state.nodes, edges: state.edges });
      }
    }
    return { knowledgeBase: newKB };
  }),
  removeKnowledgeFile: (path) => set((state) => {
    const newKB = state.knowledgeBase.filter((p) => p !== path);
    if (state.activeConfigId) {
      const config = state.configs.find(c => c.id === state.activeConfigId);
      if (config) {
        get().saveConfig({ ...config, knowledgeBase: newKB, nodes: state.nodes, edges: state.edges });
      }
    }
    return { knowledgeBase: newKB };
  }),
  toggleNodeGlobal: (nodeId, isGlobal) => {
    const state = get();
    const node = state.nodes.find(n => n.id === nodeId);
    if (node) {
      state.updateNodeData(nodeId, { isGlobal });
    }
  },

  // Chat Configuration
  chatMode: 'models',
  setChatMode: (mode) => set({ chatMode: mode }),

  // Execution Control
  activeAbortController: null,
  setAbortController: (ac) => set({ activeAbortController: ac }),
  abortGeneration: () => {
    const ac = get().activeAbortController;
    if (ac) {
      ac.abort();
      set({ activeAbortController: null });
    }
  },

  // Message Queue
  messageQueue: [],
  enqueueMessage: (content) => set((state) => ({ messageQueue: [...state.messageQueue, content] })),
  dequeueMessage: () => {
    const queue = get().messageQueue;
    if (queue.length === 0) return null;
    const [next, ...rest] = queue;
    set({ messageQueue: rest });
    return next;
  },

  // Chat Input Draft
  chatInput: '',
  setChatInput: (input) => set({ chatInput: input }),

  globalUsage: {
    totalTokens: 0,
    totalCost: 0,
    totalRequests: 0
  },
  usageHistory: [],
  sessionCost: 0,
  maxSessionBudget: 1.0,
  setMaxSessionBudget: (limit) => set({ maxSessionBudget: limit }),
  resetSessionCost: () => set({ sessionCost: 0 }),

    }),
    {
      name: 'arena-storage',
      partialize: (state) => ({
        models: state.models,
        nodes: state.nodes,
        edges: state.edges,
        configs: state.configs,
        historicalChats: state.historicalChats,
        messages: state.messages,
        responses: state.responses,
        currentChatId: state.currentChatId,
        globalUsage: state.globalUsage,
        usageHistory: state.usageHistory,
        activeConfigId: state.activeConfigId,
        chatMode: state.chatMode,
        maxSessionBudget: state.maxSessionBudget,
        knowledgeBase: state.knowledgeBase
        // Note: chatInput is NOT persisted - it survives tab switching (in memory) but clears on page reload
      }),
      // After rehydration, mark any interrupted (streaming/pending) responses as error
      onRehydrateStorage: () => (state) => {
        if (!state) return
        const needsFix = state.responses.some(r => 
          r.status === 'streaming' || 
          r.status === 'pending' || 
          r.pipelineSteps?.some(s => s.status === 'running' || s.status === 'idle')
        )
        if (!needsFix) return

        const fixedResponses = state.responses.map(r => {
          const isInterrupted = r.status === 'streaming' || r.status === 'pending'
          const hasStuckSteps = r.pipelineSteps?.some(s => s.status === 'running' || s.status === 'idle')
          
          if (isInterrupted || hasStuckSteps) {
            return {
              ...r,
              status: 'error' as const,
              content: r.content || '[Interrupted by page reload. Use the "Resume Pipeline" button below to continue.]',
              pipelineSteps: r.pipelineSteps?.map(s =>
                (s.status === 'running' || s.status === 'idle')
                  ? { ...s, status: 'error' as NodeStatus, result: s.result || '[Interrupted]' }
                  : s
              )
            }
          }
          return r
        })

        // Sync into historicalChats too
        const fixedChats = state.historicalChats.map(chat => ({
          ...chat,
          responses: chat.responses.map(r =>
            (r.status === 'streaming' || r.status === 'pending')
              ? { ...r, status: 'error' as const, content: r.content || '[Interrupted]' }
              : r
          )
        }))

        useArenaStore.setState({ 
          responses: fixedResponses, 
          historicalChats: fixedChats,
          activeAbortController: null // Clear any stale controller state
        })
      }
    }
  )
)
