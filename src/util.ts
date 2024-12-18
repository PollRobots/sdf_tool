import mime from "mime";

export function reference(...els: any[]) {}

export async function saveFilePicker(text: string, filename?: string) {
  return saveFilePickerComplete([text], filename || "untitled.sdf");
}

export function getMimeType(path: string): string {
  if (path.endsWith(".sdf")) {
    return "text/plain";
  }
  return mime.getType(path) || "application/octet-stream";
}

export async function saveFilePickerComplete(
  data: BlobPart[] | Blob,
  suggestedName: string
): Promise<string> {
  const blob = Array.isArray(data)
    ? new Blob(data, { type: getMimeType(suggestedName) })
    : data;

  if (!Reflect.has(window, "showSaveFilePicker")) {
    return saveFallback(blob);
  }

  const handle = await showSaveFilePicker({
    suggestedName: suggestedName,
    types: [
      {
        description: "SDF Tool files",
        accept: {
          "text/plain": [".sdf"],
        },
      },
      {
        description: "Text files",
        accept: {
          "text/plain": [".txt"],
        },
      },
      {
        description: "Image files",
        accept: {
          "image/png": [".png"],
          "image/jpeg": [".jpg", ".jpeg"],
          "image/gif": [".gif"],
        },
      },
    ],
  });

  const writable = await handle.createWritable();
  await writable.write(blob);
  await writable.close();
  return handle.name;
}

function saveFallback(blob: Blob) {
  const anchor = document.createElement("a");
  anchor.href = window.URL.createObjectURL(blob);
  anchor.download = "untitled.sdf";
  anchor.click();
  return "untitled.sdf";
}

export async function openFilePicker(): Promise<File> {
  let text = "";
  if (!Reflect.has(window, "showOpenFilePicker")) {
    return openFallback();
  }

  const [handle] = await showOpenFilePicker({
    types: [
      {
        description: "SDF Tool file",
        accept: {
          "text/plain": [".sdf"],
        },
      },
    ],
    multiple: false,
  });

  const file = await handle.getFile();
  return file;
}

function openFallback(): Promise<File> {
  return new Promise<File>((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = false;
    input.accept = ".sdf,text/plain";
    const timeout = window.setTimeout(
      () => reject(new Error("Timed out opening file")),
      10 * 60 * 1000 // times out after 10 minutes
    );
    input.addEventListener("change", async () => {
      const files = input.files;
      if (!files || files.length == 0) {
        return reject(new Error("No files"));
      }
      const file = files.item(0);
      if (!file) {
        return reject(new Error("No File"));
      }
      window.clearTimeout(timeout);
      resolve(file);
    });

    input.click();
  });
}
