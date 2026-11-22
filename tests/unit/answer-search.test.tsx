import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AnswerSearch from "@/components/AnswerSearch";

const SUGGESTIONS = [
  { id: "1", name: "Caramelo", picture: "c1", extra: "Ozuna" },
  { id: "2", name: "Caramelito", picture: "c2", extra: "Rauw Alejandro" },
  { id: "3", name: "Caramel", picture: "", extra: "Sleep Token" },
];

function Harness({ onSubmit, target = "song" as "song" | "artist", disabled = false }: { onSubmit: (t: string) => void; target?: "song" | "artist"; disabled?: boolean }) {
  const [v, setV] = useState("");
  return <AnswerSearch value={v} onChange={setV} onSubmit={onSubmit} target={target} disabled={disabled} />;
}

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn(async () => ({ json: async () => ({ data: SUGGESTIONS }) }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("AnswerSearch (buscador para responder)", () => {
  it("no busca con menos de 2 letras", async () => {
    render(<Harness onSubmit={vi.fn()} />);
    await userEvent.type(screen.getByRole("combobox"), "c");
    await new Promise((r) => setTimeout(r, 350));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("busca canciones en Deezer con espera (debounce) y muestra título, artista y portada", async () => {
    render(<Harness onSubmit={vi.fn()} />);
    await userEvent.type(screen.getByRole("combobox"), "cara");
    const options = await screen.findAllByRole("option");
    expect(fetchMock).toHaveBeenCalledTimes(1); // una sola búsqueda aunque se escribieron 4 letras
    expect(fetchMock.mock.calls[0][0]).toBe("/api/deezer/search?type=track&q=cara");
    expect(options).toHaveLength(3);
    expect(options[0]).toHaveTextContent("Caramelo");
    expect(options[0]).toHaveTextContent("Ozuna");
    expect(options[0].querySelector("img")?.getAttribute("src")).toBe("c1");
  });

  it("para el artista busca artistas y no muestra subtítulo", async () => {
    render(<Harness onSubmit={vi.fn()} target="artist" />);
    await userEvent.type(screen.getByRole("combobox"), "karol");
    await screen.findAllByRole("option");
    expect(fetchMock.mock.calls[0][0]).toBe("/api/deezer/search?type=artist&q=karol");
    expect(screen.queryByText("Ozuna")).toBeNull();
  });

  it("al hacer clic en una sugerencia responde con ese nombre", async () => {
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);
    await userEvent.type(screen.getByRole("combobox"), "cara");
    await userEvent.click((await screen.findAllByRole("option"))[1]);
    expect(onSubmit).toHaveBeenCalledWith("Caramelito");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("con flechas y Enter elige; Escape cierra la lista", async () => {
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);
    const input = screen.getByRole("combobox");
    await userEvent.type(input, "cara");
    await screen.findAllByRole("option");
    await userEvent.keyboard("{ArrowDown}{ArrowDown}{ArrowDown}{ArrowUp}");
    expect(screen.getAllByRole("option")[1]).toHaveAttribute("aria-selected", "true");
    expect(input).toHaveAttribute("aria-activedescendant");
    await userEvent.keyboard("{Enter}");
    expect(onSubmit).toHaveBeenCalledWith("Caramelito");

    await userEvent.type(input, "x");
    await screen.findAllByRole("option");
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("Enter sin elegir sugerencia responde con el texto libre (recortado)", async () => {
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);
    await userEvent.type(screen.getByRole("combobox"), "  mi respuesta  {Enter}");
    expect(onSubmit).toHaveBeenCalledWith("mi respuesta");
  });

  it("el botón Responder envía el texto y está desactivado si está vacío", async () => {
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);
    const btn = screen.getByRole("button", { name: "Responder" });
    expect(btn).toBeDisabled();
    await userEvent.type(screen.getByRole("combobox"), "tusa");
    await userEvent.click(btn);
    expect(onSubmit).toHaveBeenCalledWith("tusa");
  });

  it("ignora respuestas viejas si el usuario siguió escribiendo", async () => {
    let release!: () => void;
    fetchMock.mockImplementationOnce(() => new Promise((r) => (release = () => r({ json: async () => ({ data: [{ id: "old", name: "VIEJA", picture: "" }] }) }))));
    render(<Harness onSubmit={vi.fn()} />);
    const input = screen.getByRole("combobox");
    await userEvent.type(input, "ca");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await userEvent.type(input, "ram");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    release();
    await screen.findAllByRole("option");
    expect(screen.queryByText("VIEJA")).toBeNull();
  });

  it("si la búsqueda falla, no rompe y no muestra lista", async () => {
    fetchMock.mockRejectedValue(new Error("red"));
    render(<Harness onSubmit={vi.fn()} />);
    await userEvent.type(screen.getByRole("combobox"), "cara");
    await new Promise((r) => setTimeout(r, 400));
    expect(screen.queryAllByRole("option")).toHaveLength(0);
  });

  it("desactivado (ronda cerrada o sin intentos) no deja escribir ni buscar", () => {
    render(<Harness onSubmit={vi.fn()} disabled />);
    expect(screen.getByRole("combobox")).toBeDisabled();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "cara" } });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
