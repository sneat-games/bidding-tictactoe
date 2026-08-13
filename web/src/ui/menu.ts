// Mode-select menu. Resolves to either "vs-bot" or "vs-friend". Pure DOM,
// returns a promise.

export type MenuChoice = "vs-bot" | "vs-friend";

export function renderMenu(root: HTMLElement): Promise<MenuChoice> {
  root.innerHTML = "";
  return new Promise((resolve) => {
    const wrap = document.createElement("div");
    wrap.className = "menu";
    wrap.innerHTML = `<h2>Pick a mode to play Bidding Tic-Tac-Toe:</h2>`;

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

    wrap.append(bot, friend);
    root.append(wrap);
  });
}