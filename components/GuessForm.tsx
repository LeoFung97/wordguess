"use client";

import { FormEvent, useState } from "react";
import { Converter } from "opencc-js/t2cn";

type GuessFormProps = {
  onGuess: (word: string) => Promise<boolean | void> | boolean | void;
  disabled?: boolean;
  placeholder?: string;
  buttonLabel?: string;
};

const twoCharacterChineseWord = /^[\u4e00-\u9fff]{2}$/u;
const toSimplifiedChinese = Converter({ from: "tw", to: "cn" });

export function GuessForm({
  onGuess,
  disabled = false,
  placeholder = "输入两个汉字，可用拼音或注音输入法",
  buttonLabel = "提交",
}: GuessFormProps) {
  const [word, setWord] = useState("");
  const [formError, setFormError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedWord = word.trim().replace(/\s+/g, "");
    const simplifiedWord = toSimplifiedChinese(normalizedWord);
    if (!normalizedWord || disabled || isSubmitting) {
      return;
    }

    if (!twoCharacterChineseWord.test(simplifiedWord)) {
      setFormError("请输入两个汉字。");
      return;
    }

    setFormError("");
    setWord(simplifiedWord);
    setIsSubmitting(true);
    try {
      const result = await onGuess(simplifiedWord);
      if (result !== false) {
        setWord("");
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 sm:flex-row">
      <div className="flex-1">
        <input
          value={word}
          onChange={(event) => {
            setWord(event.target.value);
            setFormError("");
          }}
          disabled={disabled || isSubmitting}
          placeholder={placeholder}
          className="min-h-14 w-full rounded-2xl border border-white/10 bg-white/10 px-5 text-lg text-white outline-none transition placeholder:text-white/35 focus:border-teal-200/70 focus:bg-white/[0.14]"
        />
        {formError ? <p className="mt-2 text-sm text-rose-200">{formError}</p> : null}
      </div>
      <button
        type="submit"
        disabled={disabled || isSubmitting}
        className="min-h-14 rounded-2xl bg-gradient-to-r from-teal-300 to-cyan-300 px-7 font-bold text-slate-950 shadow-lg shadow-cyan-950/20 transition hover:scale-[1.01] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isSubmitting ? "计算中" : buttonLabel}
      </button>
    </form>
  );
}
