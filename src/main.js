
const NOTION_API_URL = `https://api.notion.com/v1/databases/${DATABASE_ID}/query`;
const NOTION_VERSION = '2022-06-28';
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent';


function stripHtmlTags(html) {
	return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function fetchHtml(url) {
	const response = UrlFetchApp.fetch(url, {
		method: 'get',
		muteHttpExceptions: true,
		followRedirects: true,
	});
	return response.getContentText();
}

// タイトルは abs ページ、本文は HTML ページから取得
function fetchArxivContent(absUrl) {
	// abs ページからタイトルを抽出
	// <h1 class="title mathjax"><span class="descriptor">Title:</span> ...</h1>
	const absHtml = fetchHtml(absUrl);
	const titleMatch = absHtml.match(/<h1[^>]*class="[^"]*title[^"]*"[^>]*>([\s\S]*?)<\/h1>/);
	const title = titleMatch
		? stripHtmlTags(titleMatch[1]).replace(/^Title:\s*/, '').trim()
		: '';

	// HTML ページから論文本文を抽出
	const htmlUrl = absUrl.replace('/abs/', '/html/');
	const paperHtml = fetchHtml(htmlUrl);
	const articleMatch = paperHtml.match(/<article[^>]*>([\s\S]*?)<\/article>/);
	const body = articleMatch ? stripHtmlTags(articleMatch[1]).trim() : '';

	return { title, body };
}

// Gemini API を呼び出して論文を要約
function callGemini(text) {
	const prompt = `# 指示
あなたは機械学習、とりわけ生成AIやInformation Retrievalに詳しい研究者で、オープンソースでの卓越した開発経験を持つエンジニアでもあります。以下の「入力」に記載の論文について、以下の観点で説明してください。
回答は日本語でお願いします。
出力はmarkdown形式とし、markdown部分だけを出力してください。あなたの応答用の修飾文言は不要です。特に「\`\`\`」で括ることは避けてください。
各観点は ## の見出しで出力してください。リストが必要な場合は箇条書き（-）を使ってください。
括弧内の文字数は回答の目安であり、見出しや出力には文字数を含めないでください。

# 観点
- 著者はどういった所属？過去にどのような研究をしていた？（100文字程度）
- どんな内容の論文？（300文字程度）
- 先行研究と比べてどこがすごい？（300文字程度）
- 技術や手法のキモはどこ？（500文字程度）
- 技術や手法のキモについて、具体例を使って、詳細に説明して（1200文字程度）
- どうやって有効だと検証した？（300文字程度）
- 議論はある？あるならどんな内容？（300文字程度）

# 入力
${text}

# 出力`;

	const options = {
		method: 'post',
		headers: {
			'Content-Type': 'application/json',
			'X-goog-api-key': GEMINI_API_KEY,
		},
		payload: JSON.stringify({
			contents: [
				{
					parts: [{ text: prompt }]
				}
			]
		}),
		muteHttpExceptions: true,
	};

	const maxRetries = 2;
	for (let attempt = 0; attempt <= maxRetries; attempt++) {
		const response = UrlFetchApp.fetch(GEMINI_API_URL, options);

		if (response.getResponseCode() === 503) {
			if (attempt < maxRetries) {
				Logger.log(`Gemini API 503, retrying (${attempt + 1}/${maxRetries})...`);
				Utilities.sleep(30000);
				continue;
			}
			throw new Error(`Gemini API returned 503 after ${maxRetries} retries`);
		}

		const result = JSON.parse(response.getContentText());
		if (!result.candidates || result.candidates.length === 0) {
			throw new Error('Gemini API returned no candidates: ' + JSON.stringify(result));
		}
		return result.candidates[0].content.parts[0].text;
	}
}

// Notion
function getNotionData() {
	const payload = {
		"filter": {
			"property": "status",
			"select": {
				"is_empty": true
			}
		}
	};

	const options = {
		method: 'post',
		headers: {
			Authorization: `Bearer ${NOTION_API_TOKEN}`,
			'Content-Type': 'application/json',
			'Notion-Version': NOTION_VERSION
		},
		payload: JSON.stringify(payload),
	};
	const response = UrlFetchApp.fetch(NOTION_API_URL, options);
	return JSON.parse(response.getContentText()).results;
}

function getUnprocessedRecords() {
	records = getNotionData();

	const targets = records.map(record => {
		const url_obj = record.properties.url.rich_text[0];
		if (url_obj === undefined) {
			return null;
		}
		url = url_obj.text.content;

		const summary_obj = record.properties.summary.title[0];
		if (summary_obj !== undefined) {
			return null;
		}

		return {
			record_id: record.id,
			url: url,
		};
	})
		.filter(record => record !== null);

	return targets;
}

function updateRecordSelectProperty(record_id) {
	const url = `https://api.notion.com/v1/pages/${record_id}`;
	const options = {
		method: 'patch',
		headers: {
			Authorization: `Bearer ${NOTION_API_TOKEN}`,
			'Content-Type': 'application/json',
			'Notion-Version': NOTION_VERSION
		},
		payload: JSON.stringify({
			properties: {
				status: {
					select: {
						name: "未"
					}
				}
			}
		})
	};

	const response = UrlFetchApp.fetch(url, options);
	return JSON.parse(response.getContentText());
}

function updateRecordSummaryTitle(record_id, title) {
	const url = `https://api.notion.com/v1/pages/${record_id}`;
	const options = {
		method: 'patch',
		headers: {
			Authorization: `Bearer ${NOTION_API_TOKEN}`,
			'Content-Type': 'application/json',
			'Notion-Version': NOTION_VERSION
		},
		payload: JSON.stringify({
			properties: {
				summary: {
					title: [
						{
							text: {
								content: title,
							}
						}
					]
				}
			}
		})
	};

	const response = UrlFetchApp.fetch(url, options);
	return JSON.parse(response.getContentText());
}

// **bold**, *italic*, `code` をNotionのrich_text形式に変換
function parseRichText(text) {
	const richText = [];
	const regex = /\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`|([^*`]+)/g;
	let match;
	while ((match = regex.exec(text)) !== null) {
		if (match[1] !== undefined) {
			richText.push({ type: 'text', text: { content: match[1] }, annotations: { bold: true } });
		} else if (match[2] !== undefined) {
			richText.push({ type: 'text', text: { content: match[2] }, annotations: { italic: true } });
		} else if (match[3] !== undefined) {
			richText.push({ type: 'text', text: { content: match[3] }, annotations: { code: true } });
		} else if (match[4] !== undefined && match[4].length > 0) {
			richText.push({ type: 'text', text: { content: match[4] } });
		}
	}
	return richText.length > 0 ? richText : [{ type: 'text', text: { content: text } }];
}

// markdownをNotionブロック配列に変換
function toBlocks(content) {
	const blocks = [];
	for (const line of content.split('\n')) {
		if (line.trim() === '') continue;

		if (line.startsWith('## ')) {
			blocks.push({ object: 'block', type: 'heading_2', heading_2: { rich_text: parseRichText(line.slice(3).trim()) } });
		} else if (line.startsWith('### ')) {
			blocks.push({ object: 'block', type: 'heading_3', heading_3: { rich_text: parseRichText(line.slice(4).trim()) } });
		} else if (/^\s*\d+\.\s+/.test(line)) {
			blocks.push({ object: 'block', type: 'numbered_list_item', numbered_list_item: { rich_text: parseRichText(line.replace(/^\s*\d+\.\s+/, '').trim()) } });
		} else if (/^\s*[-*]\s+/.test(line)) {
			blocks.push({ object: 'block', type: 'bulleted_list_item', bulleted_list_item: { rich_text: parseRichText(line.replace(/^\s*[-*]\s+/, '').trim()) } });
		} else {
			blocks.push({ object: 'block', type: 'paragraph', paragraph: { rich_text: parseRichText(line.trim()) } });
		}
	}
	return blocks;
}

// Notion APIの上限100ブロック/リクエストに対応してバッチ送信
function addBlockToPage(pageId, content) {
	const url = `https://api.notion.com/v1/blocks/${pageId}/children`;
	const blocks = toBlocks(content);

	for (let i = 0; i < blocks.length; i += 100) {
		const options = {
			method: 'patch',
			headers: {
				Authorization: `Bearer ${NOTION_API_TOKEN}`,
				'Content-Type': 'application/json',
				'Notion-Version': NOTION_VERSION
			},
			muteHttpExceptions: false,
			payload: JSON.stringify({ children: blocks.slice(i, i + 100) })
		};
		try {
			const response = UrlFetchApp.fetch(url, options);
			Logger.log(JSON.parse(response.getContentText()));
		} catch (e) {
			Logger.log("Error: " + e);
		}
	}
}

function main() {
	const targetRecords = getUnprocessedRecords();
	targetRecords.forEach((record) => {
		try {
			const { title, body } = fetchArxivContent(record.url);
			const translatedBody = callGemini(body);

			const notionTitleResp = updateRecordSummaryTitle(record.record_id, title);
			console.log(notionTitleResp);
			const notionBlockResp = addBlockToPage(record.record_id, translatedBody);
			console.log(notionBlockResp);
			const notionStatusResp = updateRecordSelectProperty(record.record_id);
			console.log(notionStatusResp);
		} catch (e) {
			updateRecordSummaryTitle(record.record_id, 'Err: ' + e);
		}
	});
}

