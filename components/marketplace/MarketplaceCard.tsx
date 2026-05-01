import { FC } from 'react';
import { MarketplaceIntegration } from '@/lib/integrations/types';

interface MarketplaceCardProps {
  integration: MarketplaceIntegration;
  onInstall: (id: string) => void;
}

export const MarketplaceCard: FC<MarketplaceCardProps> = ({
  integration,
  onInstall,
}) => {
  const getCategoryColor = (category: string) => {
    const colors: Record<string, string> = {
      development: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300',
      communication: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300',
      productivity: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-300',
      analytics: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-300',
      automation: 'bg-pink-100 text-pink-800 dark:bg-pink-900 dark:text-pink-300',
    };
    return colors[category] || 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-300';
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 
                    hover:shadow-lg transition-all duration-200 overflow-hidden">
      <div className="p-5">
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 
                          flex items-center justify-center text-white font-bold text-lg">
              {integration.name.charAt(0).toUpperCase()}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-gray-900 dark:text-white">
                  {integration.name}
                </h3>
                {integration.verified && (
                  <span className="inline-flex items-center px-2 py-0.5 rounded text-xs 
                                 font-medium bg-blue-100 text-blue-800 dark:bg-blue-900 
                                 dark:text-blue-300" title="Verified by Hephaestus Team">
                    ✅
                  </span>
                )}
              </div>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                by {integration.author}
              </p>
            </div>
          </div>
          
          <span className={`px-2 py-1 rounded-full text-xs font-medium ${getCategoryColor(integration.category)}`}>
            {integration.category}
          </span>
        </div>

        <p className="text-gray-600 dark:text-gray-400 text-sm mb-4 line-clamp-2">
          {integration.description}
        </p>

        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-4 text-sm">
            <div className="flex items-center gap-1">
              ⭐ <span className="font-medium text-gray-700 dark:text-gray-300">
                {integration.rating}
              </span>
            </div>
            <div className="flex items-center gap-1">
              📥 <span className="text-gray-500 dark:text-gray-400">
                {integration.downloads.toLocaleString()}
              </span>
            </div>
          </div>
          
          {integration.installed ? (
            <span className="px-3 py-1 rounded-full text-sm font-medium 
                           bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300">
              Installed
            </span>
          ) : (
            <button
              onClick={() => onInstall(integration.id)}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium
                       hover:bg-blue-700 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2
                       transition-colors duration-200"
            >
              Install
            </button>
          )}
        </div>

        {integration.installed && (
          <div className="pt-3 border-t border-gray-100 dark:border-gray-700">
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-500 dark:text-gray-400">Last updated</span>
              <span className="text-gray-700 dark:text-gray-300">2 days ago</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};