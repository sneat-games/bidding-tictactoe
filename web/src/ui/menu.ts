// Mode-select menu. Resolves to either "vs-bot" or "vs-friend", or "leave"
// (when the user closes the menu). Pure DOM, returns a promise.
//
// Two mode cards (kit menu-card styling — see @sneat/game-kit's theme.css)
// resolve the choice on a single click each, same as the plain buttons this
// replaces: there is no separate "Play" submit step, so the resolved values
// and the instant, no-network render are unchanged — this is presentation
// only.

export type MenuChoice = "vs-bot" | "vs-friend" | "leave";

interface ModeCardOptions {
  mode: MenuChoice;
  label: string;
  desc: string;
  onPick(): void;
}

export function renderMenu(root: HTMLElement): Promise<MenuChoice> {
  root.innerHTML = "";
  return new Promise((resolve) => {
    const wrap = document.createElement("div");
    wrap.className = "menu";

    const title = document.createElement("h2");
    title.className = "menu__title";
    title.textContent = "Play Bidding Tic-Tac-Toe";
    wrap.append(title);

    const options = document.createElement("div");
    options.className = "menu__options";
    options.append(
      modeCard({
        mode: "vs-bot",
        label: "vs Bot",
        desc: "Play instantly against the built-in bot.",
        onPick: () => resolve("vs-bot"),
      }),
      modeCard({
        mode: "vs-friend",
        label: "vs Friend",
        desc: "Invite a friend with a share link.",
        onPick: () => resolve("vs-friend"),
      }),
    );
    wrap.append(options);

    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.textContent = "Leave";
    cancel.className = "btn btn--ghost";
    cancel.addEventListener("click", () => resolve("leave"));
    wrap.append(cancel);

    root.append(wrap);
  });
}

function modeCard(opts: ModeCardOptions): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "menu-card";
  btn.setAttribute("data-mode", opts.mode);

  const label = document.createElement("span");
  label.className = "menu-card__label";
  label.textContent = opts.label;

  const desc = document.createElement("span");
  desc.className = "menu-card__desc";
  desc.textContent = opts.desc;

  btn.append(label, desc);
  btn.addEventListener("click", opts.onPick);
  return btn;
}
