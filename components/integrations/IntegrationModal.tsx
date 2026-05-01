import { FC, useState } from 'react';
import { IntegrationConfig, IntegrationSettings } from '@/lib/integrations/types';

interface IntegrationModalProps {
  config: IntegrationConfig;
  isOpen: boolean;
  onClose: () => void;
  onSave: (settings: IntegrationSettings) => void;
  initialSettings?: IntegrationSettings;
}

export const IntegrationModal: FC<IntegrationModalProps> = ({
  config,
  isOpen,
  onClose,
  onSave,
  initialSettings = {},
}) => {
  const [settings, setSettings] = useState<IntegrationSettings>(initialSettings);
  const [isTesting, setIsTesting] = useState(false);

  if (!isOpen) return null;

  const handleChange = (key: string, value: any) => {
    setSettings(prev => ({
      ...prev,
      [key]: value,
    }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(settings);
  };

  const handleTestConnection = async () => {
    setIsTesting(true);
    try {
      // Здесь будет вызов API для тестирования подключения
      await new Promise(resolve => setTimeout(resolve, 1000));
      alert('Тест подключения успешен!');
    } catch (error) {
      alert('Ошибка тестирования подключения');
    } finally {
      setIsTesting(false);
    }
  };

  const renderField = (field: any) => {
    const value = settings[field.key] || '';

    switch (field.type) {
      case 'password':
        return (
          <input
            type="password"
            value={value as string}
            onChange={(e) => handleChange(field.key, e.target.value)}
            placeholder={field.placeholder}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg 
                     bg-white dark:bg-gray-700 text-gray-900 dark:text-white
                     focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        );

      case 'textarea':
        return (
          <textarea
            value={value as string}
            onChange={(e) => handleChange(field.key, e.target.value)}
            placeholder={field.placeholder}
            rows={4}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg 
                     bg-white dark:bg-gray-700 text-gray-900 dark:text-white
                     focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        );

      case 'select':
        return (
          <select
            value={value as string}
            onChange={(e) => handleChange(field.key, e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg 
                     bg-white dark:bg-gray-700 text-gray-900 dark:text-white
                     focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            <option value="">Выберите...</option>
            {field.options?.map((option: any) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        );

      case 'boolean':
        return (
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={value as boolean}
              onChange={(e) => handleChange(field.key, e.target.checked)}
              className="w-4 h-4 text-blue-600 border-gray-300 rounded 
                       focus:ring-blue-500 dark:focus:ring-blue-600"
            />
            <span className="text-sm text-gray-600 dark:text-gray-400">
              {field.label}
            </span>
          </label>
        );

      default:
        return (
          <input
            type="text"
            value={value as string}
            onChange={(e) => handleChange(field.key, e.target.value)}
            placeholder={field.placeholder}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg 
                     bg-white dark:bg-gray-700 text-gray-900 dark:text-white
                     focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        );
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex items-center justify-center min-h-screen p-4">
        {/* Фон */}
        <div 
          className="fixed inset-0 bg-black opacity-50"
          onClick={onClose}
        ></div>

        {/* Модальное окно */}
        <div className="relative bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-lg w-full p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xl font-semibold text-gray-900 dark:text-white">
              ⚙️ Настройка {config.name}
            </h3>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-500 dark:hover:text-gray-300"
            >
              ✕
            </button>
          </div>

          <p className="text-gray-600 dark:text-gray-400 mb-6">
            {config.description}
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            {config.settingsSchema.map((field) => (
              <div key={field.key}>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  {field.label}
                  {field.required && <span className="text-red-500"> *</span>}
                </label>
                {renderField(field)}
                {field.helpText && (
                  <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                    {field.helpText}
                  </p>
                )}
              </div>
            ))}

            <div className="flex gap-3 pt-4">
              <button
                type="button"
                onClick={handleTestConnection}
                disabled={isTesting}
                className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 
                         rounded-lg text-gray-700 dark:text-gray-300 
                         hover:bg-gray-50 dark:hover:bg-gray-700
                         disabled:opacity-50 disabled:cursor-not-allowed
                         transition-colors"
              >
                {isTesting ? 'Тестирование...' : 'Тест подключения'}
              </button>
              
              <button
                type="button"
                onClick={onClose}
                className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 
                         rounded-lg text-gray-700 dark:text-gray-300 
                         hover:bg-gray-50 dark:hover:bg-gray-700
                         transition-colors"
              >
                Отмена
              </button>
              
              <button
                type="submit"
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg
                         hover:bg-blue-700 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2
                         transition-colors"
              >
                Сохранить
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};