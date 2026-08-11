import { describe, it, expect } from "vitest";
import { newRoomId, roomIdFromLocation, shareLinkFor, ROOM_ID_LENGTH } from "./room";

describe("room ids", () => {
  it("newRoomId is the right length and alphabet", () => {
    for (let i = 0; i < 50; i++) {
      const id = newRoomId();
      expect(id).toHaveLength(ROOM_ID_LENGTH);
      expect(/^[A-HJ-NP-Z2-9]{6}$/.test(id)).toBe(true);
    }
  });

  it("roomIdFromLocation reads #room=... from the href", () => {
    expect(roomIdFromLocation("https://sneat.games/bidding-tic-tac-toe/#room=ABC234")).toBe("ABC234");
  });

  it("returns null when there is no room fragment", () => {
    expect(roomIdFromLocation("https://sneat.games/bidding-tic-tac-toe/")).toBeNull();
  });

  it("returns null when the code is malformed (bad alphabet or wrong length)", () => {
    expect(roomIdFromLocation("https://sneat.games/#room=ABC1")).toBeNull(); // length 4
    expect(roomIdFromLocation("https://sneat.games/#room=ABC23O")).toBeNull(); // contains 'O'
    expect(roomIdFromLocation("https://sneat.games/#room=abc234")).toBeNull(); // lowercase
  });

  it("shareLinkFor builds a URL ending with the room fragment", () => {
    expect(shareLinkFor("https://sneat.games/bidding-tic-tac-toe/", "ABC234")).toBe(
      "https://sneat.games/bidding-tic-tac-toe/#room=ABC234",
    );
    expect(shareLinkFor("https://sneat.games/bidding-tic-tac-toe", "ABC234")).toBe(
      "https://sneat.games/bidding-tic-tac-toe/#room=ABC234",
    );
  });
});