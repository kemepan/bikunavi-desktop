// データ管理画面。main側の companion:data-* ハンドラとやり取りする。
const sectionsRoot = document.querySelector("#sections");

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  Object.assign(node, props);
  for (const child of children) node.append(child);
  return node;
}

function renderSection({ title, count, items, emptyText, onClearAll, clearLabel }) {
  const heading = el("h2", {}, [
    document.createTextNode(title),
    el("span", { className: "count", textContent: count ? `${count}件` : "" })
  ]);
  if (onClearAll && count) {
    const clear = el("button", { className: "danger", textContent: clearLabel || "全部削除" });
    clear.addEventListener("click", onClearAll);
    heading.append(clear);
  }
  const section = el("section", {}, [heading]);
  if (!count) {
    section.append(el("p", { className: "empty", textContent: emptyText || "まだありません。" }));
  } else {
    const list = el("ul");
    for (const item of items) list.append(item);
    section.append(list);
  }
  return section;
}

function listItem(bodyText, metaText, { onDelete, onEdit, editValue = bodyText } = {}) {
  const body = el("span", { className: "body", textContent: bodyText });
  if (metaText) body.append(el("span", { className: "meta", textContent: `　${metaText}` }));
  const item = el("li", {}, [body]);
  const actions = el("span", { className: "actions" });
  if (onEdit) {
    const edit = el("button", { textContent: "編集" });
    edit.addEventListener("click", () => {
      const editor = el("textarea", {
        className: "editor",
        value: String(editValue || ""),
        rows: String(editValue || "").includes("\n") ? 5 : 3,
        ariaLabel: `${bodyText}を編集`
      });
      const save = el("button", { textContent: "保存" });
      const cancel = el("button", { textContent: "やめる" });
      item.classList.add("is-editing");
      item.replaceChildren(editor, actions);
      actions.replaceChildren(save, cancel);
      editor.focus();
      editor.setSelectionRange(editor.value.length, editor.value.length);
      cancel.addEventListener("click", () => render());
      save.addEventListener("click", async () => {
        save.disabled = true;
        try {
          const result = await onEdit(editor.value);
          if (result?.ok) {
            await render();
            return;
          }
          window.alert(result?.error || "保存できませんでした。");
        } catch (error) {
          console.error(error);
          window.alert("保存できませんでした。びくたんを再起動して、もう一度試してください。");
        }
        save.disabled = false;
        editor.focus();
      });
    });
    actions.append(edit);
  }
  if (onDelete) {
    const remove = el("button", { className: "danger", textContent: "削除" });
    remove.addEventListener("click", onDelete);
    actions.append(remove);
  }
  if (actions.childElementCount) item.append(actions);
  return item;
}

async function updateItem(category, key, value) {
  return bikunavi.invoke("companion:data-update", category, key, value);
}

async function deleteItem(category, key, label) {
  if (!window.confirm(`${label}を削除します。よろしいですか？`)) return;
  await bikunavi.invoke("companion:data-delete", category, key);
  await render();
}

async function clearCategory(category, label) {
  if (!window.confirm(`${label}をすべて削除します。元に戻せません。よろしいですか？`)) return;
  await bikunavi.invoke("companion:data-clear", category);
  await render();
}

async function render() {
  const data = await bikunavi.invoke("companion:data-overview");
  sectionsRoot.replaceChildren();

  sectionsRoot.append(renderSection({
    title: `呼び名: ${data.userName || "（未設定）"}`,
    count: data.userName ? 1 : 0,
    emptyText: "呼び名はまだ教えていません。",
    items: data.userName
      ? [listItem(`びくたんはあなたを「${data.userName}」と呼びます`, "", {
        editValue: data.userName,
        onEdit: (value) => updateItem("userName", "user_address", value),
        onDelete: () => deleteItem("characterAnswer", "user_address", "呼び名")
      })]
      : []
  }));

  sectionsRoot.append(renderSection({
    title: "ことば帳（教えた言葉）",
    count: data.learnedWords.length,
    onClearAll: () => clearCategory("learnedWords", "ことば帳"),
    items: data.learnedWords.map((word, index) =>
      listItem(word.text, word.date, {
        onEdit: (value) => updateItem("learnedWord", index, value),
        onDelete: () => deleteItem("learnedWord", index, "この言葉")
      }))
  }));

  sectionsRoot.append(renderSection({
    title: "思い出帳",
    count: data.sharedMemories.length,
    onClearAll: () => clearCategory("sharedMemories", "思い出帳"),
    items: data.sharedMemories.map((memory, index) =>
      listItem(memory.text, memory.date, {
        onEdit: (value) => updateItem("sharedMemory", index, value),
        onDelete: () => deleteItem("sharedMemory", index, "この思い出")
      }))
  }));

  sectionsRoot.append(renderSection({
    title: "性格・話し方の回答",
    count: data.characterAnswers.length + data.growthAnswers.length,
    onClearAll: () => clearCategory("personality", "性格・話し方の回答"),
    items: [
      ...data.characterAnswers.map((answer) =>
        listItem(`${answer.question} → ${answer.answer}`, "", {
          editValue: answer.answer,
          onEdit: (value) => updateItem("characterAnswer", answer.id, value),
          onDelete: () => deleteItem("characterAnswer", answer.id, "この回答")
        })),
      ...data.growthAnswers.map((answer) =>
        listItem(`${answer.question} → ${answer.answer}`, "", {
          editValue: answer.answer,
          onEdit: (value) => updateItem("growthAnswer", answer.id, value),
          onDelete: () => deleteItem("growthAnswer", answer.id, "この回答")
        }))
    ]
  }));

  sectionsRoot.append(renderSection({
    title: "日記",
    count: data.diaries.length,
    onClearAll: () => clearCategory("diaries", "日記"),
    items: data.diaries.map((diary) =>
      listItem(diary.preview, diary.date, {
        editValue: diary.lines.join("\n"),
        onEdit: (value) => updateItem("diary", diary.date, value),
        onDelete: () => deleteItem("diary", diary.date, `${diary.date}の日記`)
      }))
  }));

  sectionsRoot.append(renderSection({
    title: "気になる記事",
    count: data.savedLinks.length,
    onClearAll: () => clearCategory("savedLinks", "気になる記事"),
    items: data.savedLinks.map((link) =>
      listItem(link.title, link.source, {
        onDelete: () => deleteItem("savedLink", link.url, "この記事")
      }))
  }));

  sectionsRoot.append(renderSection({
    title: "会話・セリフの履歴",
    count: data.historyCount,
    emptyText: "履歴はありません。",
    onClearAll: () => clearCategory("history", "会話・セリフの履歴"),
    clearLabel: "履歴を消す",
    items: [listItem(
      `会話 ${data.chatCount}件 / セリフ ${data.lineCount}件を保存中`,
      "",
      { onDelete: () => clearCategory("history", "会話・セリフの履歴") }
    )]
  }));

  const keySection = el("section", {}, [el("h2", { textContent: "APIキー" })]);
  const keyList = el("ul");
  const claudeBody = el("span", {
    className: "body",
    textContent: data.apiKeys.claude.present
      ? `Claude APIキー: 保存済み（${data.apiKeys.claude.encrypted ? "暗号化して保存" : "暗号化できない環境のため平文保存"}）`
      : "Claude APIキー: 未設定"
  });
  const claudeItem = el("li", {}, [claudeBody]);
  if (data.apiKeys.claude.present) {
    const remove = el("button", { className: "danger", textContent: "削除" });
    remove.addEventListener("click", () => deleteItem("apiKeyClaude", "", "Claude APIキー"));
    claudeItem.append(remove);
  }
  keyList.append(claudeItem);
  const geminiBody = el("span", {
    className: "body",
    textContent: data.apiKeys.gemini.present
      ? "Gemini APIキー: 保存済み（~/.gemini/.env・このアプリ外のファイル）"
      : "Gemini APIキー: 未設定"
  });
  const geminiItem = el("li", {}, [geminiBody]);
  if (data.apiKeys.gemini.present) {
    const remove = el("button", { className: "danger", textContent: "削除" });
    remove.addEventListener("click", () => deleteItem("apiKeyGemini", "", "Gemini APIキー"));
    geminiItem.append(remove);
  }
  keyList.append(geminiItem);
  keySection.append(keyList);
  sectionsRoot.append(keySection);
}

document.querySelector("#forget-all").addEventListener("click", async () => {
  if (!window.confirm("びくたんの記憶をすべて削除します。呼び名・ことば帳・思い出帳・性格の回答・日記・履歴・気になる記事が消え、元に戻せません。よろしいですか？")) return;
  if (!window.confirm("本当に削除しますか？")) return;
  await bikunavi.invoke("companion:data-clear", "all");
  await render();
});

render().catch((error) => {
  console.error(error);
  sectionsRoot.textContent = "データを読み込めませんでした。";
});
