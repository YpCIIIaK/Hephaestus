import { FC } from 'react';
import { IntegrationConfig } from '@/lib/integrations/types';

interface IntegrationCardProps {
  config: IntegrationConfig;
  isActive: boolean;
  onToggle: (id: string) => void;
  onConfigure: (id: string) => void;
}

export const IntegrationCard: FC<IntegrationCardProps> = ({
  config,
  isActive,
  onToggle,
  onConfigure,
}) => {
  const getIcon = (iconName: string) => {
    const icons: Record<string, string> = {
      github: '🐙',
      jira: '🟦',
      linear: '🟪',
      notion: '🖤',
      slack: '🟣',
      discord: '🔵',
      webhook: '🔗',
      zapier: '🟠',
      make: '🔵',
    };
    return icons[iconName] || '🔌';
  };

  return (
    <div className={`
      p-4 rounded-lg border-2 transition-all duration-200
      ${isActive 
        ? 'border-green-500 bg-green-50 dark:bg-green-900/20' 
        : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
      }
    `}>
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3">
          <span className="text-2xl">{getIcon(config.icon)}</span>
          <div>
            <h3 className="font-semibold text-gray-900 dark:text-white">
              {config.name}
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {config.description}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => onConfigure(config.id)}
            className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 
                     rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            title="Настройки"
          >
            ⚙️
          </button>
          <button
            onClick={() => onToggle(config.id)}
            className={`
              px-3 py-1 rounded-full text-sm font-medium transition-all
              ${isActive
                ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300 hover:bg-green-200 dark:hover:bg-green-800'
                : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
              }
            `}
          >
            {isActive ? 'Активно' : 'Неактивно'}
          </button>
        </div>
      </div>

      {isActive && (
        <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-2 text-sm">
            <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
            <span className="text-green-700 dark:text-green-400">
              Интеграция активна
            </span>
          </div>
        </div>
      )}

      {!config.enabled && (
        <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
          <div className="text-sm text-yellow-600 dark:text-yellow-400 flex items-center gap-2">
            ⚠️ Эта интеграция пока недоступна
          </div>
        </div>
      )}
    </div>
  );
};