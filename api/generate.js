// Vercel 서버리스 함수: POST /api/generate
// 환경변수 GEMINI_API_KEY 에서 API 키를 읽습니다. (코드에 키를 직접 쓰지 않음)

const MODEL = "gemini-2.5-flash";
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

function buildPrompt(keyword) {
  return `당신은 그림책 전문 사서 "책탐정 코난"입니다.
사용자 키워드: "${keyword}"

국립중앙도서관, 어린이도서관 등 도서관 공공 서지 자료(도서관 정보나루 등)를 웹에서 검색해,
이 키워드와 관련된 실제 존재하는 한국어 그림책 5권을 찾아 주세요.

규칙:
- 실제로 존재하는 책만 알려주세요. 확인되지 않는 정보는 지어내지 말고 빈 문자열("")로 두세요.
- 각 책은 title(제목), author(저자), publisher(출판사), summary(줄거리, 2~3문장), cover(표지 이미지 URL, 확실하지 않으면 "")를 포함합니다.
- 반드시 아래 JSON 형식만 출력하세요. 설명 문장이나 마크다운 코드블록은 쓰지 마세요.

{"books":[{"title":"","author":"","publisher":"","summary":"","cover":""}]}`;
}

function extractBooks(text) {
  if (!text) return [];
  const cleaned = text.replace(/```json|```/gi, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return [];

  try {
    const parsed = JSON.parse(cleaned.slice(start, end + 1));
    const list = Array.isArray(parsed.books) ? parsed.books : [];
    return list
      .filter((b) => b && typeof b.title === "string" && b.title.trim())
      .slice(0, 10)
      .map((b) => ({
        title: String(b.title || "").trim(),
        author: String(b.author || "").trim(),
        publisher: String(b.publisher || "").trim(),
        summary: String(b.summary || "").trim(),
        cover: String(b.cover || "").trim()
      }));
  } catch (e) {
    return [];
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "POST 요청만 사용할 수 있어요." });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res
      .status(500)
      .json({ error: "서버에 GEMINI_API_KEY 환경변수가 설정되지 않았어요." });
  }

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }
  const keyword = String((body && body.keyword) || "").trim().slice(0, 50);
  if (!keyword) {
    return res.status(400).json({ error: "키워드를 입력해 주세요." });
  }

  try {
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey
      },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: buildPrompt(keyword) }] }],
        // 웹(도서관 자료 포함) 검색으로 실제 책 정보를 근거로 삼게 함
        tools: [{ google_search: {} }],
        generationConfig: { temperature: 0.4 }
      })
    });

    if (!response.ok) {
      const detail = await response.text();
      console.error("Gemini API error:", response.status, detail);
      return res
        .status(502)
        .json({ error: "AI 서버 응답에 문제가 있어요. 잠시 후 다시 시도해 주세요." });
    }

    const data = await response.json();
    const parts =
      (data.candidates &&
        data.candidates[0] &&
        data.candidates[0].content &&
        data.candidates[0].content.parts) || [];
    const text = parts.map((p) => p.text || "").join("");

    const books = extractBooks(text);
    return res.status(200).json({ books });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "검색 중 오류가 발생했어요." });
  }
};
