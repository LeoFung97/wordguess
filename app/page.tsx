import Link from "next/link";

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-6 py-8">
      <nav className="flex items-center justify-between">
        <div className="text-lg font-bold tracking-[0.4em] text-teal-100">字距</div>
        <div className="rounded-full border border-white/10 bg-white/[0.06] px-4 py-2 text-sm text-white/60">
          Chinese Semantle
        </div>
      </nav>

      <section className="grid flex-1 items-center gap-10 py-16 lg:grid-cols-[1.05fr_0.95fr]">
        <div>
          <p className="mb-5 inline-flex rounded-full border border-teal-200/20 bg-teal-200/10 px-4 py-2 text-sm text-teal-100">
            基于中文 Word2Vec 的语义猜词
          </p>
          <h1 className="text-5xl font-black leading-tight tracking-tight text-white sm:text-7xl">
            猜的不是字面，
            <span className="block bg-gradient-to-r from-teal-200 via-cyan-200 to-violet-200 bg-clip-text text-transparent">
              是词与词的距离。
            </span>
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-8 text-white/65">
            输入两个汉字的常用词，系统会用词向量计算它和目标词的语义相似度。
            越接近，温度越高。一个人挑战，或开房间和朋友一起猜。
          </p>

          <div className="mt-9 flex flex-col gap-4 sm:flex-row">
            <Link
              href="/play"
              className="rounded-2xl bg-gradient-to-r from-teal-300 to-cyan-300 px-7 py-4 text-center font-bold text-slate-950 shadow-xl shadow-cyan-950/25 transition hover:scale-[1.02]"
            >
              单人开始
            </Link>
            <Link
              href="/lobby/new"
              className="rounded-2xl border border-white/15 bg-white/[0.08] px-7 py-4 text-center font-bold text-white backdrop-blur transition hover:bg-white/[0.12]"
            >
              创建大厅
            </Link>
          </div>
        </div>

        <div className="rounded-[2rem] border border-white/10 bg-white/[0.06] p-6 shadow-2xl shadow-black/20 backdrop-blur">
          <div className="rounded-[1.5rem] bg-slate-950/50 p-5">
            <div className="mb-5 flex items-center justify-between">
              <span className="text-sm text-white/50">今日目标</span>
              <span className="rounded-full bg-emerald-300/15 px-3 py-1 text-xs text-emerald-100">2 字词库</span>
            </div>
            {[
              ["朋友", "61.42", "接近"],
              ["同学", "72.38", "很热"],
              ["老师", "41.09", "偏远"],
              ["家庭", "88.74", "烫手"],
            ].map(([word, score, label]) => (
              <div key={word} className="mb-3 rounded-2xl border border-white/10 bg-white/[0.06] p-4">
                <div className="flex items-center justify-between">
                  <span className="text-2xl font-semibold tracking-[0.25em]">{word}</span>
                  <span className="text-xl font-bold text-teal-200">{score}</span>
                </div>
                <div className="mt-3 h-2 rounded-full bg-white/10">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-cyan-300 to-emerald-300"
                    style={{ width: `${score}%` }}
                  />
                </div>
                <p className="mt-2 text-xs text-white/45">{label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
