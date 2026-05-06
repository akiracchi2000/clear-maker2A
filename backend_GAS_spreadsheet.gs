/**
 * Clear Maker2 - Backend API (Google Apps Script) スプレッドシート連携版
 * 
 * フロントエンドからのリクエストを受け取り、Gemini APIへ中継します。
 * 問題番号に基づいてスプレッドシートから問題文や模範解答を読み取ります。
 */

const SYSTEM_PROMPTS = {
  math: `Role:
あなたは東大・京大などの難関国立大学の数学の採点官「香川（カガワ）先生」です。受験生が書いた答案を、記述試験の観点から厳しく、かつ建設的に添削してください。
ただし、解答者の意欲をそぐような冷たい表現は絶対に避け、必ずポジティブで励ます言葉を掛けてください。

Instruction:
・文頭は必ず「カガワです。早速ですが解答を添削しますね。」といった挨拶からスタートしてください。
・数式を出力する際は、インライン数式は $ $ で、ブロック数式は $$ $$ で囲んでください。
・最終的な解答（答え）の部分は、必ず \\bm{} を用いて太字にしてください。（例: $\\bm{x=3}$）

添削の6つの評価ポイント：
1. 方針の選択
2. 論理の正確性
3. 計算の過程
4. 記述の丁寧さ
5. 条件の確認
6. 別解・効率性

Output Format:
 **【正誤と部分点の目安】**
 **【総評】** (S・A・B・Cの4段階)
 **【項目別チェック】**
 **【具体的な修正案】**
 **【模範解答例】**
 **【カガワ先生からのアドバイス】**
【確信度: XX%】
`,
  other: "あなたは優秀な採点官です。与えられた生徒の解答を丁寧に添削してください。"
};

// 類題シートの検索範囲。必要に応じて、テスト回ごとの行番号をここで調整します。
// キーは問題IDの左から2桁目・3桁目で取る回数です。start/end はスプレッドシート上の1始まりの行番号です。
// 未設定の回は類題検索を行いません。
const REVIEW_ROUND_ROW_RANGES = {
  "06": { start: 36, end: 58 },
  "07": { start: 36, end: 58 },
  "08": { start: 99, end: 119 },
  "09": { start: 361, end: 480 },
  "10": { start: 481, end: 600 }
};

function doOptions(e) {
  return createResponse({ status: "ok" });
}

function doPost(e) {
  try {
    // 【管理者用】生徒アプリ用の共通Gemini APIキーをここに設定します
    const STUDENT_APP_API_KEY = "AIzaSyBdi-oeghS12Uxwqy-GYT3HahDfEGhYSlg";
    
    // 【管理者用】作成した問題リスト・成績管理用のGoogleスプレッドシートのIDをここに設定します
    const SPREADSHEET_ID = "19pvwoUlpJazr6M6I03O93IMyXF1mzUZ83s1EttAhnT0";
    const REVIEW_PROBLEM_SPREADSHEET_ID = "1qm-m5qJEwmYrMqOUai_koYWpL_jr-6VNfSj9QMC-gec";
    const PROBLEM_IMAGE_FOLDER_ID = "19I6V6aLIeI70a-4O94DTNqSqWx1_xnuh";

    const requestData = JSON.parse(e.postData.contents);
    const action = requestData.action;

    // --- 新機能: プルダウン用の問題データ取得 ---
    if (action === "getProblems") {

      try {
        const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
        // 名前によらず、一番左にあるシートを問題リストとして取得する
        const sheet = spreadsheet.getSheets()[0];
        if (!sheet) return createResponse({ error: "Sheet not found" }, 404);
        
        const data = sheet.getDataRange().getValues();
        const problemData = {};
        const problemImageMap = getProblemImageMapSafe(PROBLEM_IMAGE_FOLDER_ID);
        // 1行目はヘッダーなので2行目から
        for (let i = 1; i < data.length; i++) {
          const id = String(data[i][0] || "").trim();    // A列: 問題ID
          const round = String(data[i][1] || "").trim(); // B列: 回・単元
          const label = String(data[i][2] || "").trim(); // C列: 表示名
          const question = String(data[i][3] || "").trim(); // D列: 問題文
          const imageUrl = getProblemImageUrlFromMap(id, data[i][5] || "", problemImageMap); // F列があれば優先。なければ問題ID.pngを検索
          
          if (!id || !round || !label) continue;
          
          if (!problemData[round]) {
            problemData[round] = [];
          }
          problemData[round].push({ id: id, label: label, imageUrl: imageUrl });
        }
        return createResponse({ status: "success", data: problemData });
      } catch (err) {
        return createResponse({ error: err.toString() }, 500);
      }
    }

    if (action === "getProblemImage") {
      try {
        const problemId = String(requestData.problemId || "").trim();
        const imageData = getProblemImageDataUrl(problemId, PROBLEM_IMAGE_FOLDER_ID);
        if (!imageData) return createResponse({ status: "not_found", imageData: "" });
        return createResponse({ status: "success", imageData: imageData });
      } catch (err) {
        return createResponse({ status: "error", error: err.toString(), imageData: "" });
      }
    }

    // --- 新機能: 添削結果の集約（スプレッドシートへの保存） ---
    if (action === "saveResult") {

      try {
        const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName("提出履歴");
        if (!sheet) return createResponse({ error: "Sheet '提出履歴' not found" }, 404);
        
        const text = requestData.resultText || "";
        
        // 判定部分のパース（抽出）
        let badgeText = "";
        const badgeMatch = text.match(/\[判定\]\s*([^\n]+)/);
        if (badgeMatch) {
            badgeText = badgeMatch[1].trim();
        } else {
            if (text.includes("レベルアップ")) badgeText = "レベルアップして次の問題へ！";
            else if (text.includes("同じレベル")) badgeText = "同じレベルの次の問題へ！";
        }
        
        // 詳細部分のパース
        let detailText = text;
        const detailSplit = text.split(/\[詳細\]/);
        if (detailSplit.length > 1) {
            detailText = detailSplit[1].trim();
        }

        const now = new Date();
        const formattedDate = Utilities.formatDate(now, "Asia/Tokyo", "yyyy/MM/dd HH:mm:ss");

        // A列: 日時, B列: 生徒番号, C列: 問題ID, D列: 判定, E列: 詳細コメント, F列: 生テキスト
        sheet.appendRow([
          formattedDate,
          requestData.studentId || "",
          requestData.problemId || "",
          badgeText,
          detailText,
          text
        ]);

        return createResponse({ status: "success" });
      } catch (err) {
        return createResponse({ error: err.toString() }, 500);
      }
    }

    if (action === "getTodayReview") {
      try {
        const studentId = String(requestData.studentId || "").trim();
        const resultSheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName("提出履歴");
        if (!resultSheet) return createResponse({ error: "Sheet '提出履歴' not found" }, 404);

        const today = Utilities.formatDate(new Date(), "Asia/Tokyo", "yyyy/MM/dd");
        const resultRows = resultSheet.getDataRange().getValues();
        const sourceProblemMap = getProblemTextMap(SPREADSHEET_ID);
        const targetRounds = {};
        const targetThemes = {};
        const targetRoundRanges = {};
        const retryProblemIds = [];
        const answeredProblemIds = [];
        const retryCauses = [];
        const retryCauseByProblem = {};

        for (let i = 1; i < resultRows.length; i++) {
          const submittedAt = resultRows[i][0];
          const rowDate = submittedAt instanceof Date
            ? Utilities.formatDate(submittedAt, "Asia/Tokyo", "yyyy/MM/dd")
            : String(submittedAt || "").slice(0, 10);
          const rowStudentId = String(resultRows[i][1] || "").trim();
          const problemId = String(resultRows[i][2] || "").trim();
          const badgeText = String(resultRows[i][3] || "");
          const detailText = String(resultRows[i][4] || "");

          if (rowDate !== today) continue;
          if (studentId && rowStudentId && rowStudentId !== studentId) continue;
          if (!problemId) continue;

          answeredProblemIds.push(problemId);

          const shouldRetry = !badgeText.includes("レベルアップ") || hasWrongAnswer(detailText);
          if (!shouldRetry) continue;

          const round = getRoundFromProblemId(problemId);
          const sourceText = sourceProblemMap[problemId] || "";
          const cause = extractRetryCause(detailText);
          const themes = inferProblemThemes(sourceText || detailText);
          const selectedProblemThemes = themes.length > 0 ? [themes[0]] : [];

          if (!round && selectedProblemThemes.length === 0) continue;

          if (round) targetRounds[round] = true;
          if (round) targetRoundRanges[round] = REVIEW_ROUND_ROW_RANGES[round] || null;
          selectedProblemThemes.forEach(theme => targetThemes[theme] = true);
          retryProblemIds.push(problemId);
          if (!retryCauseByProblem[problemId]) {
            retryCauseByProblem[problemId] = {
              problemId: problemId,
              cause: cause,
              themes: selectedProblemThemes
            };
            retryCauses.push(retryCauseByProblem[problemId]);
          } else {
            retryCauseByProblem[problemId].themes = uniqueValues(retryCauseByProblem[problemId].themes.concat(selectedProblemThemes));
          }
        }

        const reviewItems = [];
        if (Object.keys(targetRounds).length > 0 || Object.keys(targetThemes).length > 0) {
          const reviewSheet = SpreadsheetApp.openById(REVIEW_PROBLEM_SPREADSHEET_ID).getSheets()[0];
          if (!reviewSheet) return createResponse({ error: "Review problem sheet not found" }, 404);

          const reviewRows = reviewSheet.getDataRange().getValues();
          const themeCandidates = {};
          const roundCandidates = {};
          const selectedRounds = {};
          const hasThemeTargets = Object.keys(targetThemes).length > 0;
          for (let i = 1; i < reviewRows.length; i++) {
            const numbers = reviewRows[i].slice(0, 4).map(value => String(value || "").trim());
            const text = String(reviewRows[i][4] || "").trim();
            if (!text) continue;
            const rowNumber = i + 1;
            if (!isRowInRoundRanges(rowNumber, targetRoundRanges)) continue;

            const matchedRound = hasThemeTargets ? "" : numbers
              .map(number => getRoundFromProblemId(number))
              .find(round => targetRounds[round] && !selectedRounds[round]);
            const rowSearchText = reviewRows[i].slice(0, Math.max(5, reviewRows[i].length)).join("\n");
            const matchedThemes = getMatchedThemes(rowSearchText, targetThemes)
              .filter(theme => targetThemes[theme]);
            if (!matchedRound && matchedThemes.length === 0) continue;

            const item = {
              numberA: numbers[0],
              numberB: numbers[1],
              numberC: numbers[2],
              numberD: numbers[3],
              displayNumber: numbers.join(""),
              question: text,
              matchType: matchedThemes.length > 0 ? "theme" : "round",
              themes: matchedThemes,
              round: matchedRound || ""
            };
            item.displayLabel = normalizeReviewDisplayLabel(formatReviewProblemLabel(numbers));

            if (matchedThemes.length > 0) {
              matchedThemes.forEach(theme => {
                if (!themeCandidates[theme]) themeCandidates[theme] = [];
                themeCandidates[theme].push(item);
              });
            } else if (matchedRound) {
              if (!roundCandidates[matchedRound]) roundCandidates[matchedRound] = [];
              roundCandidates[matchedRound].push(item);
            }
          }

          Object.keys(themeCandidates).forEach(theme => {
            const selected = chooseRandomItem(themeCandidates[theme]);
            if (selected) reviewItems.push(selected);
          });
          Object.keys(roundCandidates).forEach(round => {
            const selected = chooseRandomItem(roundCandidates[round]);
            if (selected) reviewItems.push(selected);
          });
          shuffleArray(reviewItems);
          if (reviewItems.length > 3) reviewItems.length = 3;
        }

        return createResponse({
          status: "success",
          date: today,
          answeredProblemIds: uniqueValues(answeredProblemIds),
          retryProblemIds: uniqueValues(retryProblemIds),
          retryCauses: retryCauses,
          targetThemes: Object.keys(targetThemes),
          reviewItems: reviewItems
        });
      } catch (err) {
        return createResponse({ error: err.toString() }, 500);
      }
    }

    const isStudentApp = requestData.isStudentApp || false;
    let apiKey = requestData.apiKey;
    const problemId = requestData.problemId || "";

    if (isStudentApp) {
      apiKey = STUDENT_APP_API_KEY;
    }

    const subject = requestData.subject || "other";
    const userPrompt = requestData.userPrompt || "";
    const images = requestData.images || {};

    // --- 新機能: スプレッドシート読み取り ---
    let sheetQuestionText = "";
    let sheetModelText = "";

    if (isStudentApp && problemId) {

      try {
        const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
        // 名前によらず、一番左にあるシートを問題リストとして取得する
        const sheet = spreadsheet.getSheets()[0];
        if (sheet) {
          const data = sheet.getDataRange().getValues();
          // 1行目はヘッダーと仮定。2行目から検索
          for (let i = 1; i < data.length; i++) {
            // A列(index 0)が問題番号
            if (String(data[i][0]).trim() === String(problemId).trim()) {
              sheetQuestionText = data[i][3] || ""; // D列: 問題文
              sheetModelText = data[i][4] || "";   // E列: 模範解答
              break;
            }
          }
        }
      } catch(sheetErr) {
        console.error("Spreadsheet lookup failed:", sheetErr);
      }
    }
    // --- ここまで ---

    if (!apiKey) {
      return createResponse({ error: "Gemini APIキーの指定がありません。" }, 401);
    }
    
    // API URLの設定
    const modelStr = 'gemini-3-flash-preview';
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelStr}:generateContent?key=${apiKey}`;

    const parts = [];

    // システムプロンプトの追加（生徒アプリからの場合は処理を重くしないよう重い指示をスキップ）
    if (!isStudentApp) {
      parts.push({ text: SYSTEM_PROMPTS[subject] || SYSTEM_PROMPTS.other });
    } else {
      parts.push({ text: "あなたは生徒の解答を判定する採点官です。" });
    }
    
    // 生徒の解答画像の追加
    if (images.student && images.student.length > 0) {
      parts.push({ text: "\n\n## 生徒の解答画像" });
      images.student.forEach(f => parts.push({ inline_data: { mime_type: f.mimeType, data: f.data } }));
    }
    
    // 追加プロンプトの構築（スプレッドシート情報を含む）
    let finalPrompt = "";
    if (isStudentApp && problemId) {
      finalPrompt += `この生徒は「問題番号: ${problemId}」を解答しています。\n`;
      if (sheetQuestionText) finalPrompt += `【問題】\n${sheetQuestionText}\n\n`;
      if (sheetModelText) finalPrompt += `【模範解答】\n${sheetModelText}\n\n`;
      finalPrompt += `これらを基準にして、生徒の解答写真を添削してください。\n\n`;
    }
    
    finalPrompt += userPrompt;
    parts.push({ text: `\n\n## 指示内容\n${finalPrompt}` });

    const payload = {
      contents: [{ parts: parts }],
      generationConfig: { temperature: 0.4 }
    };

    const options = {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    };

    const response = UrlFetchApp.fetch(apiUrl, options);
    const responseCode = response.getResponseCode();
    const responseData = JSON.parse(response.getContentText());

    if (responseCode !== 200) {
       return createResponse({ error: responseData.error ? responseData.error.message : "APIでエラーが発生しました" }, responseCode);
    }

    return createResponse(responseData);

  } catch (error) {
    return createResponse({ error: error.toString() }, 500);
  }
}

function createResponse(data, statusCode = 200) {
  const output = ContentService.createTextOutput(JSON.stringify(data));
  output.setMimeType(ContentService.MimeType.JSON);
  return output;
}

function getDisplayImageUrl(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (/^https?:\/\//.test(text) && text.indexOf("drive.google.com") === -1) return text;

  const fileId = extractDriveFileId(text);
  if (!fileId) return text;
  return "https://drive.google.com/uc?export=view&id=" + encodeURIComponent(fileId);
}

function getProblemImageUrl(problemId, explicitValue, folderId) {
  const explicitUrl = getDisplayImageUrl(explicitValue);
  if (explicitUrl) return explicitUrl;

  const fileId = findProblemImageFileId(problemId, folderId);
  if (!fileId) return "";
  return "https://drive.google.com/uc?export=view&id=" + encodeURIComponent(fileId);
}

function getProblemImageUrlSafe(problemId, explicitValue, folderId) {
  try {
    return getProblemImageUrl(problemId, explicitValue, folderId);
  } catch (err) {
    console.error("Problem image lookup failed for " + problemId + ": " + err);
    return "";
  }
}

function getProblemImageUrlFromMap(problemId, explicitValue, imageMap) {
  const explicitUrl = getDisplayImageUrl(explicitValue);
  if (explicitUrl) return explicitUrl;

  const fileId = imageMap[String(problemId || "").trim()] || "";
  if (!fileId) return "";
  return "https://drive.google.com/uc?export=view&id=" + encodeURIComponent(fileId);
}

function getProblemImageMapSafe(folderId) {
  try {
    return getProblemImageMap(folderId);
  } catch (err) {
    console.error("Problem image map failed: " + err);
    return {};
  }
}

function getProblemImageMap(folderId) {
  const result = {};
  if (!folderId) return result;

  const folder = DriveApp.getFolderById(folderId);
  const files = folder.getFiles();
  while (files.hasNext()) {
    const file = files.next();
    const match = file.getName().match(/^(.+?)\.(png|jpg|jpeg)$/i);
    if (!match) continue;
    const problemId = match[1].trim();
    if (!result[problemId]) result[problemId] = file.getId();
  }
  return result;
}

function findProblemImageFileId(problemId, folderId) {
  const id = String(problemId || "").trim();
  if (!id || !folderId) return "";

  const folder = DriveApp.getFolderById(folderId);
  const fileNames = [id + ".png", id + ".PNG", id + ".jpg", id + ".jpeg"];

  for (let i = 0; i < fileNames.length; i++) {
    const files = folder.getFilesByName(fileNames[i]);
    if (files.hasNext()) return files.next().getId();
  }

  return "";
}

function getProblemImageDataUrl(problemId, folderId) {
  const fileId = findProblemImageFileId(problemId, folderId);
  if (!fileId) return "";

  const file = DriveApp.getFileById(fileId);
  const blob = file.getBlob();
  const mimeType = blob.getContentType() || "image/png";
  const base64 = Utilities.base64Encode(blob.getBytes());
  return "data:" + mimeType + ";base64," + base64;
}

function extractDriveFileId(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const filePathMatch = text.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (filePathMatch) return filePathMatch[1];
  const idParamMatch = text.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (idParamMatch) return idParamMatch[1];
  if (/^[a-zA-Z0-9_-]{20,}$/.test(text)) return text;
  return "";
}

function getRoundFromProblemId(problemId) {
  const text = String(problemId || "").trim();
  if (text.length < 3) return "";
  return text.substring(1, 3);
}

function uniqueValues(values) {
  const seen = {};
  const result = [];
  values.forEach(value => {
    const text = String(value || "").trim();
    if (!text || seen[text]) return;
    seen[text] = true;
    result.push(text);
  });
  return result;
}

function getProblemTextMap(spreadsheetId) {
  const result = {};
  try {
    const sheet = SpreadsheetApp.openById(spreadsheetId).getSheets()[0];
    if (!sheet) return result;

    const rows = sheet.getDataRange().getValues();
    for (let i = 1; i < rows.length; i++) {
      const id = String(rows[i][0] || "").trim();
      if (!id) continue;
      result[id] = rows[i].slice(1, Math.max(5, rows[i].length)).join("\n");
    }
  } catch (err) {
    console.error("Problem text map failed:", err);
  }
  return result;
}

function extractThemeKeywords(text) {
  const normalized = normalizeSearchText(text);
  const themes = [
    "たすき掛け",
    "因数分解",
    "展開",
    "平方完成",
    "二次方程式",
    "二次関数",
    "判別式",
    "解と係数",
    "連立方程式",
    "不等式",
    "絶対値",
    "平方根",
    "分数式",
    "場合分け",
    "整数",
    "余り",
    "約数",
    "倍数",
    "素因数分解",
    "確率",
    "順列",
    "組合せ",
    "三角比",
    "正弦定理",
    "余弦定理",
    "図形",
    "面積",
    "円",
    "ベクトル",
    "内積",
    "数列",
    "等差数列",
    "等比数列",
    "漸化式",
    "極限",
    "微分",
    "接線",
    "増減表",
    "積分",
    "面積計算",
    "置換積分",
    "部分積分",
    "対数",
    "指数",
    "複素数",
    "軌跡",
    "最大値",
    "最小値",
    "計算ミス",
    "符号ミス",
    "条件",
    "定義域",
    "解の吟味"
  ];

  const aliases = {
    "たすき掛け": ["たすきがけ", "襷掛け", "襷がけ"],
    "因数分解": ["因数", "factor"],
    "平方完成": ["平方"],
    "判別式": ["D=", "判別"],
    "解と係数": ["解と係数の関係"],
    "場合分け": ["場合わけ"],
    "組合せ": ["組み合わせ", "combination"],
    "等差数列": ["等差"],
    "等比数列": ["等比"],
    "計算ミス": ["計算誤り", "計算間違い"],
    "符号ミス": ["符号", "プラスマイナス"],
    "解の吟味": ["吟味"]
  };

  const found = [];
  themes.forEach(theme => {
    const candidates = [theme].concat(aliases[theme] || []);
    const matched = candidates.some(candidate => normalized.includes(normalizeSearchText(candidate)));
    if (matched && found.indexOf(theme) === -1) found.push(theme);
  });

  return found;
}

function inferProblemThemes(text) {
  const found = extractThemeKeywords(text);
  const formulaThemes = analyzeFormulaThemes(text);
  formulaThemes.forEach(theme => {
    if (found.indexOf(theme) === -1) found.push(theme);
  });
  return normalizeThemeSet(found);
}

function normalizeThemeSet(themes) {
  let result = uniqueValues(themes);
  if (result.indexOf("たすき掛け") !== -1) {
    result = result.filter(theme => theme !== "因数分解" && theme !== "二次方程式");
  }
  if (result.indexOf("平方完成") !== -1) {
    result = result.filter(theme => theme !== "二次方程式");
  }
  return result;
}

function analyzeFormulaThemes(text) {
  const found = [];
  const normalized = normalizeSearchText(text)
    .replace(/\\left|\\right/g, "")
    .replace(/[{}]/g, "")
    .replace(/−/g, "-");

  if (hasNonMonicFactorableQuadratic(normalized)) {
    found.push("たすき掛け");
  }
  if (hasFactorableQuadratic(normalized)) {
    found.push("因数分解");
  }
  if (hasQuadraticEquation(normalized)) {
    found.push("二次方程式");
  }
  if (hasQuadraticFunction(normalized)) {
    found.push("二次関数");
  }
  if (hasInequality(normalized)) {
    found.push("不等式");
  }
  if (hasAbsoluteValue(normalized)) {
    found.push("絶対値");
  }
  if (hasSquareRoot(normalized)) {
    found.push("平方根");
  }
  if (hasFractionFormula(normalized)) {
    found.push("分数式");
  }
  if (hasSimultaneousEquation(normalized)) {
    found.push("連立方程式");
  }
  if (hasExponentialFormula(normalized)) {
    found.push("指数");
  }
  if (hasLogFormula(normalized)) {
    found.push("対数");
  }
  if (hasTrigonometricFormula(normalized)) {
    found.push("三角比");
  }
  if (hasDifferentialFormula(normalized)) {
    found.push("微分");
  }
  if (hasIntegralFormula(normalized)) {
    found.push("積分");
  }

  return found;
}

function getMatchedThemes(text, targetThemes) {
  const rowThemes = inferProblemThemes(text);
  return rowThemes.filter(theme => targetThemes[theme]);
}

function isRowInRoundRanges(rowNumber, roundRanges) {
  const ranges = Object.keys(roundRanges || {})
    .map(round => roundRanges[round])
    .filter(Boolean);
  if (ranges.length === 0) return false;

  return ranges.some(range => {
    const start = Number(range.start || 2);
    const end = Number(range.end || rowNumber);
    return rowNumber >= start && rowNumber <= end;
  });
}

function chooseRandomItem(items) {
  if (!items || items.length === 0) return null;
  return items[Math.floor(Math.random() * items.length)];
}

function shuffleArray(items) {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const temp = items[i];
    items[i] = items[j];
    items[j] = temp;
  }
  return items;
}

function formatReviewProblemLabel(numbers) {
  const values = [0, 1, 2, 3].map(index => normalizeProblemNumberText((numbers || [])[index]));
  const chapter = values[0];
  const b = values[1];
  const c = values[2];
  const d = values[3];

  if (/^\d+$/.test(chapter)) {
    if (/^\d{2,}$/.test(b) && !c && d) {
      return "第" + Number(chapter) + "章演習問題" + Number(b) + "-" + formatSubProblemMarker(d);
    }
    if (/^\d{2,}$/.test(b) && isSubProblemMarker(c)) {
      return "第" + Number(chapter) + "章演習問題" + Number(b) + "-" + formatSubProblemMarker(c) + (d || "");
    }
    if (/^[1-3]$/.test(b) && /^\d$/.test(c) && isSubProblemMarker(d)) {
      return "第" + Number(chapter) + "章演習問題" + Number(b + c) + "-" + formatSubProblemMarker(d);
    }
    if (/^\d+$/.test(b) && /^\d+$/.test(c)) {
      return "第" + Number(chapter) + "章演習問題" + Number(b) + "-" + Number(c) + (d || "");
    }
  }

  return formatReviewProblemNumber(values.filter(Boolean).join(""));
}

function formatReviewProblemNumber(value) {
  const text = normalizeProblemNumberText(value);
  if (!text) return "";

  const match = text.match(/^(\d)(\d)(\d)(.*)$/);
  if (!match) return text;

  return "第" + Number(match[1]) + "章演習問題" + Number(match[2]) + "-" + Number(match[3]) + (match[4] || "");
}

function normalizeReviewDisplayLabel(label) {
  const text = String(label || "")
    .trim()
    .replace(/[０-９]/g, function(char) { return String.fromCharCode(char.charCodeAt(0) - 0xFEE0); })
    .replace(/[（]/g, "(")
    .replace(/[）]/g, ")")
    .replace(/[‐‑‒–—―－−ー]/g, "-")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\s+/g, "");
  return text.replace(/第(\d+)章演習問題([1-3])[-ｰ]([0-9])\(([^)]+)\)/g, function(_all, chapter, tens, ones, suffix) {
    return "第" + Number(chapter) + "章演習問題" + Number(tens + ones) + "-(" + suffix + ")";
  });
}

function normalizeProblemNumberText(value) {
  return String(value || "")
    .trim()
    .replace(/[０-９]/g, char => String.fromCharCode(char.charCodeAt(0) - 0xFEE0))
    .replace(/[（]/g, "(")
    .replace(/[）]/g, ")")
    .replace(/\.0$/, "")
    .replace(/\s+/g, "");
}

function isSubProblemMarker(value) {
  const text = String(value || "").trim();
  return /^\(.+\)$/.test(text) || /^\d+$/.test(text);
}

function formatSubProblemMarker(value) {
  const text = String(value || "").trim();
  return /^\d+$/.test(text) ? "(" + Number(text) + ")" : text;
}

function normalizeSearchText(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[＋]/g, "+")
    .replace(/[－−]/g, "-")
    .replace(/[＊×]/g, "*")
    .replace(/[＝]/g, "=")
    .replace(/[＜]/g, "<")
    .replace(/[＞]/g, ">")
    .replace(/[²２]/g, "2")
    .replace(/[ \t\r\n　]/g, "")
    .replace(/[‐‑‒–—―ー]/g, "ー");
}

function hasFactorableQuadratic(normalized) {
  if (!/(x|y|a|b)\^?2|二次|2次/.test(normalized)) return false;
  if (normalized.indexOf("因数分解") !== -1 || normalized.indexOf("積の形") !== -1) return true;

  const variableMatch = normalized.match(/[xyab]/);
  if (!variableMatch) return false;
  const v = variableMatch[0];

  const escaped = v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp("([+-]?\\d*)" + escaped + "\\^?2([+-]\\d*)" + escaped + "([+-]\\d+)", "g");
  let match;
  while ((match = pattern.exec(normalized)) !== null) {
    const a = parseCoefficient(match[1]);
    const b = parseCoefficient(match[2]);
    const c = parseInt(match[3], 10);
    if (!a || isNaN(b) || isNaN(c)) continue;
    if (isFactorableQuadratic(a, b, c)) return true;
  }

  return false;
}

function hasNonMonicFactorableQuadratic(normalized) {
  const variableMatch = normalized.match(/[xyab]/);
  if (!variableMatch) return false;
  const v = variableMatch[0];
  const escaped = v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp("([+-]?\\d*)" + escaped + "\\^?2([+-]\\d*)" + escaped + "([+-]\\d+)", "g");
  let match;
  while ((match = pattern.exec(normalized)) !== null) {
    const a = parseCoefficient(match[1]);
    const b = parseCoefficient(match[2]);
    const c = parseInt(match[3], 10);
    if (!a || a === 1 || a === -1 || isNaN(b) || isNaN(c)) continue;
    if (isFactorableQuadratic(a, b, c)) return true;
  }
  return false;
}

function hasQuadraticEquation(text) {
  return /[xyab]\^?2/.test(text) && text.indexOf("=") !== -1;
}

function hasQuadraticFunction(text) {
  return /y=/.test(text) && /x\^?2/.test(text);
}

function hasInequality(text) {
  return /[<>≦≧≤≥]/.test(text) || text.indexOf("不等式") !== -1;
}

function hasAbsoluteValue(text) {
  return /\|[^|]+\|/.test(text) || text.indexOf("絶対値") !== -1 || text.indexOf("abs") !== -1;
}

function hasSquareRoot(text) {
  return text.indexOf("\\sqrt") !== -1 || text.indexOf("√") !== -1 || text.indexOf("平方根") !== -1;
}

function hasFractionFormula(text) {
  return text.indexOf("\\frac") !== -1 || /[0-9xyab]\//.test(text) || text.indexOf("分数") !== -1;
}

function hasSimultaneousEquation(text) {
  return text.indexOf("連立") !== -1 || text.indexOf("\\beginarray") !== -1 || text.indexOf("\\cases") !== -1;
}

function hasExponentialFormula(text) {
  return text.indexOf("指数") !== -1 || /([0-9]|e|a)\^[a-z]/.test(text);
}

function hasLogFormula(text) {
  return text.indexOf("log") !== -1 || text.indexOf("\\log") !== -1 || text.indexOf("対数") !== -1;
}

function hasTrigonometricFormula(text) {
  return text.indexOf("sin") !== -1 || text.indexOf("cos") !== -1 || text.indexOf("tan") !== -1 || text.indexOf("三角") !== -1;
}

function hasDifferentialFormula(text) {
  return text.indexOf("微分") !== -1 || text.indexOf("導関数") !== -1 || /f'\(|y'/.test(text);
}

function hasIntegralFormula(text) {
  return text.indexOf("\\int") !== -1 || text.indexOf("∫") !== -1 || text.indexOf("積分") !== -1;
}

function parseCoefficient(text) {
  if (text === "" || text === "+") return 1;
  if (text === "-") return -1;
  return parseInt(text, 10);
}

function isFactorableQuadratic(a, b, c) {
  const limit = Math.max(12, Math.abs(a * c) + 1);
  for (let p = -limit; p <= limit; p++) {
    if (p === 0 && a * c !== 0) continue;
    for (let q = -limit; q <= limit; q++) {
      if (p * q === a * c && p + q === b) return true;
    }
  }
  return false;
}

function extractRetryCause(text) {
  const normalized = String(text || "").replace(/\r/g, "").trim();
  if (!normalized) return "添削結果の詳細を見直して、誤答した小問と計算過程を確認しましょう。";

  const labels = [
    "フィードバック:",
    "フィードバック：",
    "原因:",
    "原因：",
    "間違えた原因:",
    "間違えた原因："
  ];

  for (let i = 0; i < labels.length; i++) {
    const index = normalized.indexOf(labels[i]);
    if (index === -1) continue;

    const afterLabel = normalized.substring(index + labels[i].length).trim();
    const firstBlock = afterLabel.split(/\n\s*\n/)[0].trim();
    return summarizeCause(firstBlock);
  }

  const lines = normalized
    .split("\n")
    .map(line => line.replace(/^[-・\s]+/, "").trim())
    .filter(Boolean);
  const causeLine = lines.find(line =>
    line.includes("誤") ||
    line.includes("間違") ||
    line.includes("不正解") ||
    line.includes("計算") ||
    line.includes("条件")
  );

  return summarizeCause(causeLine || lines[0] || normalized);
}

function hasWrongAnswer(text) {
  const normalized = String(text || "").replace(/\s+/g, "");
  if (!normalized) return false;

  const wrongMarkers = [
    "不正解",
    "誤答",
    "間違",
    "ミス",
    "×",
    "✕",
    "❌"
  ];

  return wrongMarkers.some(marker => normalized.includes(marker));
}

function summarizeCause(text) {
  const value = String(text || "").replace(/\s+/g, " ").trim();
  if (!value) return "誤答箇所を確認";
  return compactCause(value);
}

function compactCause(text) {
  let value = String(text || "")
    .replace(/\s+/g, " ")
    .replace(/^[・\-:：]+/, "")
    .trim();
  if (!value) return "誤答箇所を確認";

  const patterns = [
    { key: "たすき掛け", label: "たすき掛けのミス" },
    { key: "たすきがけ", label: "たすき掛けのミス" },
    { key: "襷", label: "たすき掛けのミス" },
    { key: "因数分解", label: "因数分解のミス" },
    { key: "平方完成", label: "平方完成のミス" },
    { key: "判別式", label: "判別式の確認不足" },
    { key: "符号", label: "符号ミス" },
    { key: "計算", label: "計算ミス" },
    { key: "条件", label: "条件確認の不足" },
    { key: "場合分け", label: "場合分けの不足" },
    { key: "定義域", label: "定義域の確認不足" },
    { key: "解の吟味", label: "解の吟味不足" },
    { key: "不正解", label: "誤答箇所の確認" },
    { key: "間違", label: "誤答箇所の確認" },
    { key: "誤答", label: "誤答箇所の確認" }
  ];

  for (let i = 0; i < patterns.length; i++) {
    if (value.indexOf(patterns[i].key) !== -1) return patterns[i].label;
  }

  value = value
    .replace(/^フィードバック[:：]?/, "")
    .replace(/^原因[:：]?/, "")
    .replace(/^間違えた原因[:：]?/, "")
    .trim();
  return shortenText(value, 20);
}

function shortenText(text, maxLength) {
  const value = String(text || "").trim();
  if (!value) return "";
  return value.length > maxLength ? value.substring(0, maxLength) + "..." : value;
}
