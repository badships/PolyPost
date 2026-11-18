import { useSettingsStore } from '@/store/settingsStore';
import { en } from '@/i18n/locales/en';
import { zh } from '@/i18n/locales/zh';

// Define the type for the dictionary based on the 'en' locale
// This ensures type safety for keys
type Dictionary = typeof en;
export type DictionaryKey = keyof Dictionary;

const dictionaries: Record<'en' | 'zh', Dictionary> = {
    en,
    zh,
};

const BUILTIN_TEMPLATE_I18N: Record<string, { name: DictionaryKey; desc: DictionaryKey }> = {
    professional: {
        name: 'polish.template.professional.name',
        desc: 'polish.template.professional.desc',
    },
    viral: {
        name: 'polish.template.viral.name',
        desc: 'polish.template.viral.desc',
    },
    casual: {
        name: 'polish.template.casual.name',
        desc: 'polish.template.casual.desc',
    },
    technical: {
        name: 'polish.template.technical.name',
        desc: 'polish.template.technical.desc',
    },
    emoji: {
        name: 'polish.template.emoji.name',
        desc: 'polish.template.emoji.desc',
    },
    concise: {
        name: 'polish.template.concise.name',
        desc: 'polish.template.concise.desc',
    },
};

export const useTranslation = () => {
    const { uiLanguage } = useSettingsStore();

    // Fallback to English if the current language dictionary or key is missing
    const t = (key: DictionaryKey, ...args: (string | number)[]): string => {
        const dictionary = dictionaries[uiLanguage] || dictionaries.en;
        let text = dictionary[key] || dictionaries.en[key] || key;

        if (args.length > 0) {
            args.forEach((arg, index) => {
                text = text.replace(`{${index}}`, String(arg));
            });
        }

        return text;
    };

    const getTemplateName = (templateId?: string | null, fallbackName?: string): string => {
        if (!templateId) return fallbackName || 'Variant';
        const mapping = BUILTIN_TEMPLATE_I18N[templateId];
        if (mapping) return t(mapping.name);
        return fallbackName || templateId;
    };

    const getTemplateDesc = (templateId?: string | null, fallbackDesc?: string): string => {
        if (!templateId) return fallbackDesc || '';
        const mapping = BUILTIN_TEMPLATE_I18N[templateId];
        if (mapping) return t(mapping.desc);
        return fallbackDesc || '';
    };

    return {
        t,
        language: uiLanguage,
        getTemplateName,
        getTemplateDesc,
    };
};
