/**
 * 题目多语言工具函数
 * 将主语言内容按请求的 locale 覆盖为翻译版本
 */

/** 支持的题目主语言 (二选一) */
export const SUPPORTED_LOCALES = ['zh', 'en'] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

/** 主语言可选项 (用于前端表单/Excel) */
export const PRIMARY_LOCALE_OPTIONS = SUPPORTED_LOCALES;

type QuestionContent = {
  title?: unknown;
  answer?: unknown;
  analysis?: unknown;
  options?: unknown;
};

export type LocalizedQuestion<T> = Omit<
  T,
  keyof QuestionContent | 'translations'
> &
  QuestionContent & { translations?: unknown };

/**
 * 规范化主语言代码
 * - 合法值 ('zh' / 'en') 原样返回
 * - 非法/缺失值回退为 'zh', 保持与历史数据兼容
 */
export function normalizeLocale(locale?: string | null): SupportedLocale {
  if (locale && (SUPPORTED_LOCALES as readonly string[]).includes(locale)) {
    return locale as SupportedLocale;
  }
  return 'zh';
}

/** 取与给定主语言相对的另一语言 (zh <-> en) */
export function otherLocale(locale: SupportedLocale): SupportedLocale {
  return locale === 'zh' ? 'en' : 'zh';
}

/** 将前端传入的翻译对象序列化为存储格式 */
export function serializeTranslations(
  translations?: Record<string, unknown>,
): string | undefined {
  if (!translations) return undefined;
  return JSON.stringify(translations);
}

/**
 * 按 locale 返回题目内容
 * - locale 与主语言相同或未指定 → 保留主内容, 解码翻译字段
 * - translations 中有对应 locale → 覆盖已翻译的字段
 * - 无对应翻译 → 回退到主语言
 */
export function localizeQuestion<
  T extends QuestionContent & { translations?: unknown; locale?: string },
>(question: T, targetLocale?: string): LocalizedQuestion<T> {
  const source = question;
  if (!source.translations) return question;

  let translations: Record<string, Record<string, unknown>> = {};
  try {
    const parsed = (
      typeof source.translations === 'string'
        ? JSON.parse(source.translations)
        : source.translations
    ) as Record<string, Record<string, unknown>>;
    translations = Object.fromEntries(
      Object.entries(parsed).map(([locale, translation]) => {
        return [
          locale,
          {
            ...translation,
            ...(typeof translation.options === 'string' && {
              options: JSON.parse(translation.options) as unknown,
            }),
          },
        ];
      }),
    );
  } catch {
    return question;
  }

  const result: LocalizedQuestion<T> = { ...source, translations };
  if (!targetLocale || targetLocale === source.locale) return result;

  const translation = translations[targetLocale];
  if (!translation) return result;

  if (translation.title) result.title = translation.title;
  if (translation.answer) result.answer = translation.answer;
  if (translation.analysis !== undefined)
    result.analysis = translation.analysis;
  if (translation.options !== undefined) {
    result.options = translation.options;
  }
  return result;
}
