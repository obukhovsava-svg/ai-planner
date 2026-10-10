"""
Builds the iPhone Shortcut "Обои ПЛАН" for Telegram users (unsigned plist) — sign with:
  shortcuts sign --mode anyone --input "shortcut/Обои ПЛАН.unsigned.shortcut" --output public/planner-wallpaper.shortcut

Actions:
  1. GET the user's wallpaper link (drawn by the planner in Telegram: today's plans | tasks)
  2. Set it as the Lock Screen wallpaper, no preview
On import the user is asked once for the link (Настройки → «Обои экрана блокировки» → «Скопировать»).
"""
import plistlib, uuid, pathlib

GET = str(uuid.uuid4()).upper()

workflow = {
    "WFWorkflowClientVersion": "2607.0.2",
    "WFWorkflowMinimumClientVersion": 900,
    "WFWorkflowMinimumClientVersionString": "900",
    "WFWorkflowIcon": {"WFWorkflowIconStartColor": 1440408063, "WFWorkflowIconGlyphNumber": 59784},
    "WFWorkflowTypes": [],
    "WFWorkflowInputContentItemClasses": [],
    "WFWorkflowHasShortcutInputVariables": False,
    "WFQuickActionSurfaces": [],
    "WFWorkflowActions": [
        {
            "WFWorkflowActionIdentifier": "is.workflow.actions.downloadurl",
            "WFWorkflowActionParameters": {
                "UUID": GET,
                "WFURL": "https://ai-planner-brain.savelyobuhov.workers.dev/wallpaper/ВСТАВЬТЕ_СВОЮ_ССЫЛКУ.jpg",
                "WFHTTPMethod": "GET",
                "ShowHeaders": False,
            },
        },
        {
            "WFWorkflowActionIdentifier": "is.workflow.actions.wallpaper.set",
            "WFWorkflowActionParameters": {
                "UUID": str(uuid.uuid4()).upper(),
                "WFInput": {
                    "Value": {"OutputUUID": GET, "Type": "ActionOutput", "OutputName": "Содержимое URL"},
                    "WFSerializationType": "WFTextTokenAttachment",
                },
                "WFWallpaperLocation": "Lock Screen",
                "WFWallpaperShowPreview": False,
                "WFWallpaperSmartCrop": False,
                "WFWallpaperLegibilityBlur": False,
                "WFWallpaperPerspectiveZoom": False,
            },
        },
    ],
    "WFWorkflowImportQuestions": [
        {
            "ActionIndex": 0,
            "Category": "Parameter",
            "ParameterKey": "WFURL",
            "DefaultValue": "",
            "Text": "Вставьте ссылку на обои из планера (Настройки → «Обои экрана блокировки» → «Скопировать ссылку»)",
        }
    ],
}

out = pathlib.Path(__file__).with_name("Обои ПЛАН.unsigned.shortcut")
out.write_bytes(plistlib.dumps(workflow, fmt=plistlib.FMT_BINARY))
print(out)
