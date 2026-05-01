import { FC, useState } from 'react';
import { useIntegrationStore } from '@/lib/integrations/store';
import { INTEGRATION_CONFIGS } from '@/lib/integrations/config';
import { IntegrationCard } from './IntegrationCard';
import { IntegrationModal } from './IntegrationModal';
import { IntegrationConfig } from '@/lib/integrations/types';

export const IntegrationsPanel: FC = () => {
  const { integrations, toggleIntegration } = useIntegrationStore();
  const [selectedIntegration, setSelectedIntegration] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const handleToggle = (id: string) => {
    toggleIntegration(id);
  };

  const handleConfigure = (id: string) => {
    setSelectedIntegration(id);
    setIsModalOpen(true);
  };

  const handleSaveSettings = (settings: any) => {
    // Здесь будет вызов API для сохранения настроек
    console.log('Saving settings for', selectedIntegration, settings);
    setIsModalOpen(false);
    setSelectedIntegration(null);
  };

  const selectedConfig = selectedIntegration 
    ? INTEGRATION_CONFIGS[selectedIntegration]
    : null;

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
            🔌 Integrations
          </h1>
          <p className="text-gray-600 dark:text-gray-400 mt-1">
            Connect external services to enhance your AI workflows
          </p>
        </div>
        
        <div className="flex items-center gap-4">
          <div className="px-3 py-1 rounded-full bg-green-100 dark:bg-green-900/20 
                        text-green-700 dark:text-green-400 text-sm font-medium">
            {integrations.filter(i => i.isEnabled).length} Active
          </div>
        </div>
      </div>

      {/* Краткая статистика */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <div className="bg-white dark:bg-gray-800 p-4 rounded-lg border border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-blue-100 dark:bg-blue-900/20 
                          flex items-center justify-center">
              <span className="text-xl">🔗</span>
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900 dark:text-white">
                {Object.keys(INTEGRATION_CONFIGS).length}
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Available Integrations
              </p>
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 p-4 rounded-lg border border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-green-100 dark:bg-green-900/20 
                          flex items-center justify-center">
              <span className="text-xl">✅</span>
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900 dark:text-white">
                {integrations.filter(i => i.isEnabled).length}
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Active Now
              </p>
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 p-4 rounded-lg border border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-purple-100 dark:bg-purple-900/20 
                          flex items-center justify-center">
              <span className="text-xl">⚡</span>
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900 dark:text-white">
                5000+
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Via Zapier/Make
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Сетка интеграций */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {Object.values(INTEGRATION_CONFIGS).map((config) => {
          const isActive = integrations.find(i => i.id === config.id)?.isEnabled || false;
          
          return (
            <IntegrationCard
              key={config.id}
              config={config}
              isActive={isActive}
              onToggle={handleToggle}
              onConfigure={handleConfigure}
            />
          );
        })}
      </div>

      {/* Пустое состояние */}
      {Object.keys(INTEGRATION_CONFIGS).length === 0 && (
        <div className="text-center py-12">
          <div className="text-6xl mb-4">🔌</div>
          <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
            No Integrations Available
          </h3>
          <p className="text-gray-500 dark:text-gray-400">
            Check back later for new integrations
          </p>
        </div>
      )}

      {/* Модальное окно настроек */}
      {selectedConfig && (
        <IntegrationModal
          config={selectedConfig}
          isOpen={isModalOpen}
          onClose={() => {
            setIsModalOpen(false);
            setSelectedIntegration(null);
          }}
          onSave={handleSaveSettings}
          initialSettings={
            integrations.find(i => i.id === selectedConfig.id)?.settings || {}
          }
        />
      )}

      {/* Блок с Zapier/Make */}
      <div className="mt-12 p-6 bg-gradient-to-r from-orange-50 to-purple-50 
                    dark:from-orange-900/20 dark:to-purple-900/20 
                    rounded-lg border border-orange-200 dark:border-orange-800">
        <div className="flex items-center gap-4 mb-4">
          <div className="text-4xl">🔗</div>
          <div>
            <h3 className="text-xl font-semibold text-gray-900 dark:text-white">
              5000+ More Integrations
            </h3>
            <p className="text-gray-600 dark:text-gray-400">
              Connect to any service via Zapier or Make.com
            </p>
          </div>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
          <div className="p-4 bg-white dark:bg-gray-800 rounded-lg">
            <h4 className="font-semibold text-gray-900 dark:text-white mb-2">
              Zapier
            </h4>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Connect to 5000+ apps with no-code workflows
            </p>
          </div>
          
          <div className="p-4 bg-white dark:bg-gray-800 rounded-lg">
            <h4 className="font-semibold text-gray-900 dark:text-white mb-2">
              Make.com
            </h4>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Visual automation builder with advanced logic
            </p>
          </div>
          
          <div className="p-4 bg-white dark:bg-gray-800 rounded-lg">
            <h4 className="font-semibold text-gray-900 dark:text-white mb-2">
              Custom Webhooks
            </h4>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Direct integration with your own services
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};