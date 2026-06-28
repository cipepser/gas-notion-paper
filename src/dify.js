// Dify
function runWorkflow(target_url) {
	const url = "https://api.dify.ai/v1/workflows/run";
	const apiKey = DIFY_API_KEY;

	const payload = {
		"inputs": {
			"url": target_url
		},
		"response_mode": "blocking",
		"user": "cipepser"
	};

	const options = {
		method: "post",
		headers: {
			"Authorization": `Bearer ${apiKey}`,
			"Content-Type": "application/json"
		},
		payload: JSON.stringify(payload),
		muteHttpExceptions: true
	};

	try {
		const response = UrlFetchApp.fetch(url, options);
		const responseText = response.getContentText();
		return JSON.parse(responseText); // 必要に応じて応答をJSONオブジェクトに変換して返します
	} catch (e) {
		Logger.log("Error: " + e.toString());
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

function addBlockToPage(pageId, content) {
	const url = `https://api.notion.com/v1/blocks/${pageId}/children`;
	const options = {
		method: 'patch',
		headers: {
			Authorization: `Bearer ${NOTION_API_TOKEN}`,
			'Content-Type': 'application/json',
			'Notion-Version': NOTION_VERSION
		},
		muteHttpExceptions: false,
		payload: JSON.stringify({
			children: toBlocks(content)
		})
	};

	try {
		const response = UrlFetchApp.fetch(url, options);
		return JSON.parse(response.getContentText());
	} catch (e) {
		Logger.log("Error: " + e);
	}
}

function toBlocks(content) {
	const blocks = content.split('\n\n').map(
		(block) => {
			return {
				object: 'block',
				type: 'paragraph',
				paragraph: {
					rich_text: [
						{ text: { content: block + '\n' } }
					]
				}
			};
		}
	);
	return blocks;
}

function main() {
	const targetRecords = getUnprocessedRecords();
	targetRecords.forEach((record) => {
		try {
			const difyResp = runWorkflow(record.url);
			console.log(difyResp);
			const notionTitleResp = updateRecordSummaryTitle(record.record_id, difyResp.data.outputs.title);
			console.log(notionTitleResp);
			const notionBlockResp = addBlockToPage(record.record_id, difyResp.data.outputs.content);
			console.log(notionBlockResp);
			const notionStatusResp = updateRecordSelectProperty(record.record_id);
			console.log(notionStatusResp);
		} catch (e) {
			updateRecordSummaryTitle(record.record_id, 'Err: ' + e);
		}
	});
}

function debug() {
	const targetRecords = getUnprocessedRecords();
	targetRecords.forEach((record) => {
		console.log(record);
		updateRecordSelectProperty(record.record_id);
	});
}
