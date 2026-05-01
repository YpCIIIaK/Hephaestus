import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { Integration, IntegrationSettings, IntegrationEvent } from './types';
import { DEFAULT_INTEGRATIONS } from './config';

interface IntegrationState {
  integrations: Integration[];
  activeIntegrations: string[];
  events: IntegrationEvent[];
  
  // Actions
  addIntegration: (integration: Integration) => void;
  updateIntegration: (id: string, updates: Partial<Integration>) => void;
  updateSettings: (id: string, settings: IntegrationSettings) => void;
  toggleIntegration: (id: string) => void;
  removeIntegration: (id: string) => void;
  setStatus: (id: string, status: Integration['status']) => void;
  addEvent: (event: IntegrationEvent) => void;
  clearEvents: () => void;
}

export const useIntegrationStore = create<IntegrationState>()(
  persist(
    (set, get) => ({
      integrations: DEFAULT_INTEGRATIONS as Integration[],
      activeIntegrations: [],
      events: [],

      addIntegration: (integration) =>
        set((state) => ({
          integrations: [...state.integrations, integration],
        })),

      updateIntegration: (id, updates) =>
        set((state) => ({
          integrations: state.integrations.map((int) =>
            int.id === id ? { ...int, ...updates, updatedAt: new Date().toISOString() } : int
          ),
        })),

      updateSettings: (id, settings) =>
        set((state) => ({
          integrations: state.integrations.map((int) =>
            int.id === id
              ? { 
                  ...int, 
                  settings: { ...int.settings, ...settings },
                  updatedAt: new Date().toISOString()
                }
              : int
          ),
        })),

      toggleIntegration: (id) =>
        set((state) => {
          const integration = state.integrations.find((i) => i.id === id);
          if (!integration) return state;

          const newIsEnabled = !integration.isEnabled;
          const newStatus = newIsEnabled ? 'active' : 'inactive';
          
          return {
            integrations: state.integrations.map((int) =>
              int.id === id
                ? { 
                    ...int, 
                    isEnabled: newIsEnabled,
                    status: newStatus,
                    updatedAt: new Date().toISOString()
                  }
                : int
            ),
            activeIntegrations: newIsEnabled
              ? [...state.activeIntegrations, id]
              : state.activeIntegrations.filter((i) => i !== id),
          };
        }),

      removeIntegration: (id) =>
        set((state) => ({
          integrations: state.integrations.filter((i) => i.id !== id),
          activeIntegrations: state.activeIntegrations.filter((i) => i !== id),
        })),

      setStatus: (id, status) =>
        set((state) => ({
          integrations: state.integrations.map((int) =>
            int.id === id
              ? { 
                  ...int, 
                  status,
                  updatedAt: new Date().toISOString(),
                  ...(status === 'error' ? { lastError: new Date().toISOString() } : {})
                }
              : int
          ),
        })),

      addEvent: (event) =>
        set((state) => ({
          events: [event, ...state.events.slice(0, 99)], // Keep last 100 events
        })),

      clearEvents: () =>
        set({ events: [] }),
    }),
    {
      name: 'integration-storage',
    }
  )
);