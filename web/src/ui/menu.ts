// Mode-select menu. Resolves to either "vs-bot" or "vs-friend", or "leave"
// (when the user closes the menu). Pure DOM, returns a promise.

export type MenuChoice = "vs-bot" | "vs-friend" | "leave";

export function renderMenu(root: HTMLElement): Promise<MenuChoice> {
  root.innerHTML = "";
  return new Promise((resolve) => {
    const wrap = document.createElement("div");
    wrap.className = "menu";
    wrap.innerHTML = `<h2>Play Bidding Tic-Tac-Toe</h2><p>Pick a mode:</p>`;

    const bot = document.createElement("button");
    bot.type = "button";
    bot.textContent = "vs Bot";
    bot.className = "menu__btn menu__btn--bot";
    bot.addEventListener("click", () => resolve("vs-bot"));

    const friend = document.createElement("button");
    friend.type = "button";
    friend.textContent = "vs Friend";
    friend.className = "menu__btn menu__btn--friend";
    friend.addEventListener("click", () => resolve("vs-friend"));

    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.textContent = "Leave";
    cancel.className = "menu__btn menu__btn--leave";
    cancel.addEventListener("click", () => resolve("leave"));

    wrap.append(bot, friend, cancel);
    root.append(wrap);
  });
}