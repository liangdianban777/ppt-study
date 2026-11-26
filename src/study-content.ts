import { Marked } from 'marked'
import type { MarkedExtension } from 'marked'
import markedFootnote from 'marked-footnote'
import markedKatex from 'marked-katex-extension'
import katex from 'katex'
import DOMPurify from 'dompurify'

export type Note = { title: string; body: string }
export type Example = Note & { subtitle: string; diagram: [string, string][] }

export const prompt = `请将我附上的英文 PPTX 或 PDF 按原始页序逐页翻译成简体中文，供我与原文对照阅读。

- 忠实、准确地翻译每页可辨认的文字，包括标题、正文、图表标签和脚注。保留原文的顺序、层级、列表和表格，准确保留数字、单位和公式。同一术语前后译法一致。
- 保留原文的含义和语气，不改写、不总结，也不添加原文没有的讲解、注释、复习重点或自测题。正文只输出译文，无需重复英文原文。无法辨认的文字在对应位置标为「[无法辨认]」，不要猜测。
- 每页使用一个 Markdown 二级页码标题，格式为「## 第 1 页｜标题译文」。从文件第 1 页开始连续编号，封面、目录、过渡页和空白页都保留。原标题缺失时用「无标题」，没有正文时在标题下写「[无正文]」。
- 只输出可复制的 Markdown，不用代码块包裹全文，不添加开场或结语。如果一次放不下，停在完整页的结尾，续写时沿用原始页码。`

export const examples: Example[] = [
  {
    title: '为什么要做主动回忆？',
    subtitle: '从「看起来熟悉」到「合上书也能说出来」',
    diagram: [['输入', '阅读材料'], ['提取', '合上讲义复述'], ['校对', '补齐遗漏']],
    body: `### 这页在讲什么
主动回忆指的是**先合上讲义，试着从记忆里找答案**。想不起来的部分，正好标出了下一轮最值得复习的地方。

### 复习重点
- 看笔记时认得出概念，合上笔记后才知道自己能否独立解释。
- 复述之后要核对原文，及时修正遗漏和误解。

### 自测
看完一页之后，你可以用什么方式检查自己能不能独立说出重点？

**参考答案：** 合上笔记，写下或复述两个关键概念，再回到原文核对。`,
  },
  {
    title: '把复习分散到几天',
    subtitle: '让同一个知识点出现在多次独立练习中',
    diagram: [['当天', '梳理概念'], ['次日', '合书自测'], ['几天后', '复测错题']],
    body: `### 这页在讲什么
间隔复习把同一个知识点分到几次短练习。隔一段时间再试着回忆，可以看到哪些内容已经记牢、哪些还需要练习。

### 复习重点
- 按离考试还有多少天安排多次复习。
- 每次先做自测，再决定该重读哪一部分。

### 自测
如果离考试还有一周，你什么时候再次检查今天学的概念？

**参考答案：** 可以安排在次日和几天后分别做一次自测。`,
  },
  {
    title: '把错题变成提示',
    subtitle: '弄清自己错在哪里，再做一道同类题',
    diagram: [['定位', '找出出错步骤'], ['归因', '写下原因'], ['验证', '独立做同类题']],
    body: `### 这页在讲什么
错题可以告诉你该补哪个环节。先定位错误发生的位置，再写下一条下次做题时可以执行的检查动作。

### 复习重点
- 区分概念不清、读题遗漏和计算失误。
- 用另一道同类题检验是否改正。

### 自测
如果连续两题都漏看单位，可以给自己留什么提示？

**参考答案：** 列式前圈出题目给出的单位，计算前统一单位。`,
  },
  {
    title: '用一次小测验收',
    subtitle: '限定时间，独立完成，再回顾失分点',
    diagram: [['准备', '选几道典型题'], ['作答', '限时完成'], ['回看', '更新复习清单']],
    body: `### 这页在讲什么
临近考试时可以用一次小测，检查自己能否在时间限制内独立提取知识并完成答题。

### 复习重点
- 选取覆盖主要题型的题目，计时完成。
- 将失分点加入最后一轮复习清单。

### 自测
小测结束后，如何确定接下来先复习哪一项？

**参考答案：** 先处理分值较高、自己仍反复出错的题型。`,
  },
]

const mathOptions = { output: 'mathml', throwOnError: false } as const
const dollarMath = markedKatex({ ...mathOptions, nonStandard: true })

// 复制出的讲解可能会转义列表行首的连字符。
const escapedList: MarkedExtension = {
  extensions: [{
    name: 'escapedList',
    level: 'block',
    start: source => source.search(/\n {0,3}\\-[ \t]+\S/u),
    tokenizer(source) {
      const match = /^ {0,3}\\-[ \t]+\S[^\n]*(?:\n(?:[ \t]*\n)* {0,3}\\-[ \t]+\S[^\n]*)*/u.exec(source)
      if (!match) return

      const raw = match[0]
      const [list] = this.lexer.blockTokens(raw.replace(/^( {0,3})\\-/gmu, '$1+'))
      return { ...list, raw }
    },
  }],
}

// 兼容 Markdown 中原样粘贴的 TeX 定界符和带转义的定界符。
const texDelimiters = [
  {
    name: 'texInline',
    level: 'inline',
    start: /\\{1,2}\(/u,
    pattern: /^(\\{1,2})\(([^\n]+?)(?<!\\)\1\)/u,
    displayMode: false,
  },
  {
    name: 'texDisplay',
    level: 'inline',
    start: /\\{1,2}\[/u,
    pattern: /^(\\{1,2})\[([^\n]+?)(?<!\\)\1\]/u,
    displayMode: true,
  },
  {
    name: 'texBlock',
    level: 'block',
    start: /(?:^|\n) {0,3}\\{1,2}\[/u,
    pattern: /^ {0,3}(\\{1,2})\[([\s\S]+?)(?<!\\)\1\]/u,
    displayMode: true,
  },
] as const

const texMath: MarkedExtension = {
  extensions: texDelimiters.map(({ name, level, start, pattern, displayMode }) => ({
    name,
    level,
    start: (source: string) => source.search(start),
    tokenizer(source) {
      const match = pattern.exec(source)
      if (!match) return

      let text = match[2].trim()
      if (match[1].length === 2) {
        // ChatGPT 复制出的 Markdown 在双反斜杠定界符内也转义了这些字符。
        text = text.replace(/\\(\\[{},|]|\\{2}(?=\s)|[_*])/gu, '$1')
      }
      return { type: name, raw: match[0], text }
    },
    renderer({ text }) {
      return katex.renderToString(text, { ...mathOptions, displayMode })
    },
  })),
}

function noteMarkdown(page: number) {
  return new Marked({ gfm: true }, escapedList, dollarMath, texMath, markedFootnote({
    prefixId: `note-${page}-footnote-`,
    description: '脚注',
    backRefLabel: '返回脚注引用',
  }))
}

export function parseNotes(text: string) {
  let markdown = noteMarkdown(0)
  let tokens = markdown.lexer(text)
  const blocks = tokens.filter(token => token.type !== 'space' && token.type !== 'footnotes')
  const first = blocks[0]
  if (blocks.length === 1 && first.type === 'code' && first.codeBlockStyle !== 'indented' && /^(?:markdown|md)?$/i.test(first.lang ?? '')) {
    markdown = noteMarkdown(0)
    tokens = markdown.lexer(first.text)
  }

  const definitions: string[] = []
  markdown.walkTokens(tokens, token => {
    if (token.type === 'def' || token.type === 'footnote') definitions.push(token.raw.trimEnd())
  })
  const references = definitions.join('\n\n')

  const pages = new Map<number, Note>()
  let note: Note | undefined
  for (const token of tokens) {
    if (token.type === 'def' || token.type === 'footnote' || token.type === 'footnotes') continue

    let heading: RegExpExecArray | null = null
    if (token.type === 'heading') {
      const content = DOMPurify.sanitize(markdown.parser([token]), {
        ALLOWED_TAGS: ['img', 'br'],
        ALLOWED_ATTR: ['alt'],
        RETURN_DOM_FRAGMENT: true,
      })
      for (const image of content.querySelectorAll('img')) image.replaceWith(image.alt)
      for (const br of content.querySelectorAll('br')) br.replaceWith(' ')
      heading = /^第\s*(\d+)\s*页\s*[｜|]\s*(.*)$/u.exec(content.textContent.replace(/\s+/gu, ' ').trim())
    }

    if (!heading) {
      if (note) note.body += token.raw
      continue
    }
    const page = Number(heading[1])
    const title = heading[2]
    if (!Number.isSafeInteger(page) || page < 1 || !title) throw new Error('请使用正整数页码和非空标题。')
    if (pages.has(page)) throw new Error(`第 ${page} 页出现了两次。请合并后再应用。`)
    note = { title, body: '' }
    pages.set(page, note)
  }
  if (!pages.size) throw new Error('没有找到页码标题。请保留「## 第 1 页｜页面标题」的格式。')
  for (const [page, item] of pages) {
    if (!item.body.trim()) throw new Error(`第 ${page} 页缺少讲解正文。请补全后再应用。`)
    if (references) item.body = `${item.body.trimEnd()}\n\n${references}`
  }
  return pages
}

export function renderMarkdown(body: string, page: number) {
  return DOMPurify.sanitize(noteMarkdown(page).parse(body, { async: false }), {
    ALLOWED_TAGS: [
      'p', 'br', 'strong', 'b', 'em', 'i', 'del', 's', 'mark', 'sup', 'sub', 'ul', 'ol', 'li', 'input',
      'blockquote', 'pre', 'code', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'table', 'thead', 'tbody', 'tr', 'th', 'td',
      'a', 'img', 'details', 'summary', 'section', 'span', 'math', 'semantics', 'annotation', 'mrow', 'mi', 'mo', 'mn',
      'mtext', 'mspace', 'ms', 'mfrac', 'msqrt', 'mroot', 'mstyle', 'mphantom', 'mpadded', 'menclose', 'msub', 'msup',
      'msubsup', 'munder', 'mover', 'munderover', 'mtable', 'mtr', 'mtd', 'merror',
    ],
    ALLOWED_ATTR: [
      'href', 'src', 'alt', 'title', 'id', 'class', 'open', 'start', 'align', 'type', 'checked', 'disabled', 'encoding',
      'display', 'mathvariant', 'mathcolor', 'mathsize', 'displaystyle', 'scriptlevel', 'stretchy', 'fence', 'separator',
      'accent', 'accentunder', 'largeop', 'movablelimits', 'lspace', 'rspace', 'minsize', 'maxsize', 'width', 'height',
      'depth', 'voffset', 'notation', 'linethickness', 'rowspacing', 'columnspacing', 'columnalign', 'rowalign',
      'rowlines', 'columnlines', 'columnspan', 'rowspan',
    ],
  })
}
