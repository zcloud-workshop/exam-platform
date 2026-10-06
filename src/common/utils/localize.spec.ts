import { localizeQuestion, serializeTranslations } from './localize';

describe('question translations', () => {
  const options = { A: 'Enable versioning', B: 'Delete the bucket' };
  const zh = {
    title: '应采用哪个方案?',
    options: { A: '启用版本控制', B: '删除存储桶' },
    answer: 'A',
  };

  it('stores translated options as an object without double encoding', () => {
    const stored = JSON.parse(serializeTranslations({ zh })!) as {
      zh: typeof zh;
    };
    expect(stored.zh.options).toEqual(zh.options);
  });

  it.each([zh.options, JSON.stringify(zh.options)])(
    'decodes current and legacy translations while preserving English',
    (translatedOptions) => {
      const question = {
        id: 'question-1',
        title: 'Which solution should be used?',
        options,
        answer: 'A',
        locale: 'en',
        translations: JSON.stringify({
          zh: { ...zh, options: translatedOptions },
        }),
      };
      const original = localizeQuestion(question);
      expect(original.title).toBe(question.title);
      expect(original.options).toEqual(options);
      expect(original.translations).toEqual({ zh });

      const translated = localizeQuestion(question, 'zh');
      expect(translated.id).toBe(question.id);
      expect(translated.title).toBe(zh.title);
      expect(translated.options).toEqual(zh.options);
      expect(translated.answer).toBe(question.answer);
      expect(question.translations).toBeDefined();
    },
  );

  it.each([
    'invalid JSON',
    JSON.stringify({ zh: { options: 'invalid JSON' } }),
  ])(
    'preserves the original question when translations cannot be decoded',
    (translations) => {
      const question = { title: 'Original', locale: 'en', translations };

      expect(localizeQuestion(question, 'zh')).toBe(question);
    },
  );
});
