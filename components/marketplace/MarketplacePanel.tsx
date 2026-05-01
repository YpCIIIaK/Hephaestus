import { FC, useState } from 'react';
import { MarketplaceCard } from './MarketplaceCard';
import { MarketplaceIntegration } from '@/lib/integrations/types';

// Демо-данные для маркетплейса
const MOCK_INTEGRATIONS: MarketplaceIntegration[] = [
  {
    id: 'github-official',
    name: 'GitHub Official',
    description: 'Official GitHub integration with full API access, PR review, and automated workflows',
    category: 'development',
    author: 'Hephaestus Team',
    rating: 4.9,
    downloads: 25000,
    verified: true,
    installed: true,
  },
  {
    id: 'jira-cloud',
    name: 'Jira Cloud',
    description: 'Seamless integration with Jira Cloud for issue tracking and project management',
    category: 'productivity',
    author: 'Atlassian',
    rating: 4.7,
    downloads: 18000,
    verified: true,
    installed: false,
  },
  {
    id: 'notion-pro',
    name: 'Notion Pro',
    description: 'Enhanced Notion integration with database sync and automated page creation',
    category: 'productivity',
    author: 'Notion Labs',
    rating: 4.8,
    downloads: 15000,
    verified: true,
    installed: false,
  },
  {
    id: 'slack-advanced',
    name: 'Slack Advanced',
    description: 'Advanced Slack integration with custom commands and workflow automation',
    category: 'communication',
    author: 'Slack Technologies',
    rating: 4.6,
    downloads: 22000,
    verified: true,
    installed: true,
  },
  {
    id: 'zapier-pro',
    name: 'Zapier Pro',
    description: 'Premium Zapier integration with 5000+ app connections and advanced triggers',
    category: 'automation',
    author: 'Zapier Inc.',
    rating: 4.9,
    downloads: 35000,
    verified: true,
    installed: false,
  },
  {
    id: 'linear-plus',
    name: 'Linear Plus',
    description: 'Enhanced Linear integration with custom fields and automated sprint planning',
    category: 'productivity',
    author: 'Linear',
    rating: 4.5,
    downloads: 8000,
    verified: false,
    installed: false,
  },
  {
    id: 'discord-bot',
    name: 'Discord Bot',
    description: 'Custom Discord bot integration with AI commands and automated notifications',
    category: 'communication',
    author: 'Discord Inc.',
    rating: 4.4,
    downloads: 12000,
    verified: true,
    installed: false,
  },
  {
    id: 'webhook-pro',
    name: 'Webhook Pro',
    description: 'Professional webhook integration with retry logic and advanced payload templates',
    category: 'automation',
    author: 'Hephaestus Team',
    rating: 4.3,
    downloads: 5000,
    verified: true,
    installed: true,
  },
];

interface MarketplacePanelProps {
  onInstall: (id: string) => void;
}

export const MarketplacePanel: FC<MarketplacePanelProps> = ({ onInstall }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');

  const categories = [
    { id: 'all', name: 'All Categories' },
    { id: 'development', name: 'Development' },
    { id: 'communication', name: 'Communication' },
    { id: 'productivity', name: 'Productivity' },
    { id: 'analytics', name: 'Analytics' },
    { id: 'automation', name: 'Automation' },
  ];

  const filteredIntegrations = MOCK_INTEGRATIONS.filter(integration => {
    const matchesSearch = integration.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         integration.description.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = selectedCategory === 'all' || integration.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
            🛍️ Integration Marketplace
          </h1>
          <p className="text-gray-600 dark:text-gray-400 mt-1">
            Discover and install new integrations to enhance your workflows
          </p>
        </div>
        
        <div className="flex items-center gap-4">
          <div className="px-3 py-1 rounded-full bg-purple-100 dark:bg-purple-900/20 
                        text-purple-700 dark:text-purple-400 text-sm font-medium">
            {MOCK_INTEGRATIONS.length} Available
          </div>
        </div>
      </div>

      {/* Search and Filters */}
      <div className="mb-8 space-y-4">
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="flex-1">
            <input
              type="text"
              placeholder="Search integrations..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 
                       rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white
                       focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
          
          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="px-4 py-2 border border-gray-300 dark:border-gray-600 
                     rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white
                     focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            {categories.map(category => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Results Count */}
      <div className="mb-6 text-sm text-gray-500 dark:text-gray-400">
        Showing {filteredIntegrations.length} of {MOCK_INTEGRATIONS.length} integrations
      </div>

      {/* Integrations Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredIntegrations.map((integration) => (
          <MarketplaceCard
            key={integration.id}
            integration={integration}
            onInstall={onInstall}
          />
        ))}
      </div>

      {/* Empty State */}
      {filteredIntegrations.length === 0 && (
        <div className="text-center py-12">
          <div className="text-6xl mb-4">🔍</div>
          <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
            No integrations found
          </h3>
          <p className="text-gray-500 dark:text-gray-400">
            Try adjusting your search or filter criteria
          </p>
        </div>
      )}

      {/* Featured Section */}
      <div className="mt-12 p-6 bg-gradient-to-r from-blue-50 to-purple-50 
                    dark:from-blue-900/20 dark:to-purple-900/20 
                    rounded-lg border border-blue-200 dark:border-blue-800">
        <div className="flex items-center gap-4 mb-4">
          <div className="text-4xl">🌟</div>
          <div>
            <h3 className="text-xl font-semibold text-gray-900 dark:text-white">
              Featured Integrations
            </h3>
            <p className="text-gray-600 dark:text-gray-400">
              Popular choices among our users
            </p>
          </div>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
          {MOCK_INTEGRATIONS.filter(i => i.verified).slice(0, 3).map(integration => (
            <div key={integration.id} className="p-4 bg-white dark:bg-gray-800 rounded-lg">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-8 h-8 rounded-lg bg-blue-100 dark:bg-blue-900/20 
                              flex items-center justify-center text-blue-600 dark:text-blue-400">
                  {integration.name.charAt(0).toUpperCase()}
                </div>
                <div>
                  <h4 className="font-semibold text-gray-900 dark:text-white">
                    {integration.name}
                  </h4>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    ⭐ {integration.rating} ({integration.downloads.toLocaleString()} downloads)
                  </p>
                </div>
              </div>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                {integration.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};