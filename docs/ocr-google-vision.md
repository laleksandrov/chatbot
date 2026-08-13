# Google Cloud Vision OCR

Сканирани PDF файлове без текстов слой се обработват локално по страници с Google Cloud Vision `DOCUMENT_TEXT_DETECTION`. Оригиналът се запазва, а за RAG се създават:

- Markdown производен документ с ясни граници на страниците;
- суров Vision JSON за одит;
- QA отчет с брой страници, символи, думи и средна увереност по страници.

## Google Cloud подготовка

1. Активирайте Cloud Vision API в избрания Google Cloud проект.
2. Създайте отделен service account само за OCR.
3. Дайте му минималните права за използване на Vision API и Service Usage.
4. Запазете JSON ключа локално като `.google-credentials/vision-ocr.json`.

Директорията `.google-credentials/` е изключена от Git. Не поставяйте JSON ключа в `.env`, repository, Forge command или чат.

## Изпълнение

```powershell
$env:GOOGLE_APPLICATION_CREDENTIALS=(Resolve-Path .google-credentials/vision-ocr.json)
node --import tsx scripts/ocr-google-vision.ts `
  --input "C:/path/document.pdf" `
  --output-dir "C:/path/ocr-output" `
  --title "Заглавие" `
  --source-url "https://official-source.example/document" `
  --document-date "2026-01-12" `
  --valid-from "2026-01-01" `
  --expected-pages 8
```

За всяка страница скриптът създава 300 DPI JPEG, изпраща го последователно към Vision с езикови подсказки `bg` и `en`, и записва пълния отговор. Временните изображения не се качват в RAG.

## Приемане

Автоматичната QA проверка изисква очаквания брой страници и поне 20 OCR символа на всяка страница. След нея човек проверява визуално номера, заглавието, таблиците, датите, процентите и поне една представителна страница от началото, средата и края.

В RAG се качва `.ocr.md` файлът като производен текст. Оригиналният PDF и суровите JSON резултати остават в одитния архив.
