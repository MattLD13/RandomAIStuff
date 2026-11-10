"""Add standalone SOLIDWORKS 2025 parts to the assembly STEP archives.

Requires Windows, pywin32 and an already-running SOLIDWORKS 2025 or 2026.
"""
from pathlib import Path
import tempfile
import zipfile
import pythoncom
import win32com.client as win32

PARTS = Path(__file__).resolve().parent.parent / 'site' / 'parts'
ARCHIVES = ('exam1-hinged-arm-parts.zip', 'exam2-slide-parts.zip', 'exam3-link-chain-parts.zip')
NULL_DISPATCH = win32.VARIANT(pythoncom.VT_DISPATCH, None)

def refint():
    return win32.VARIANT(pythoncom.VT_BYREF | pythoncom.VT_I4, 0)

def main():
    sw = win32.GetActiveObject('SldWorks.Application')
    revision = int(sw.RevisionNumber.split('.')[0])
    if revision not in (33, 34):
        raise RuntimeError('A running SOLIDWORKS 2025 or 2026 instance is required')
    original = sw.GetUserPreferenceToggle(691)  # swMultiCAD_Enable3DInterconnect
    original_dir = sw.GetCurrentWorkingDirectory
    sw.SetUserPreferenceToggle(691, False)
    try:
        with tempfile.TemporaryDirectory(prefix='cswa-solidworks-', dir=PARTS, ignore_cleanup_errors=True) as tmp:
            root = Path(tmp)
            for archive in ARCHIVES:
                source = PARTS / archive
                with zipfile.ZipFile(source) as z:
                    steps = {Path(n).name: z.read(n) for n in z.namelist() if n.lower().endswith('.step')}
                if not steps:
                    raise RuntimeError(f'No STEP files in {source}')
                files = dict(steps)
                for name, data in steps.items():
                    step = root / name
                    target = root / ('native-' + step.stem + '.SLDPRT')
                    step.write_bytes(data)
                    err, warning = refint(), refint()
                    doc = sw.LoadFile4(str(step), 'r', sw.GetImportFileData(str(step)), err)
                    if not doc:
                        raise RuntimeError(f'Import failed: {name}, error {err.value}')
                    try:
                        extension = doc.Extension
                        if not extension.SaveAs3(str(target), 0, 1, NULL_DISPATCH, NULL_DISPATCH, err, warning):
                            raise RuntimeError(f'Save failed: {name}, error {err.value}')
                        if revision == 34:
                            options = extension.GetAdvancedSaveAsOptions(0)
                            items = [win32.VARIANT(pythoncom.VT_BYREF | pythoncom.VT_VARIANT, None) for _ in range(3)]
                            options.GetItemsNameAndPath(*items)
                            options._FlagAsMethod('ModifyItemsNameAndPath')
                            options.ModifyItemsNameAndPath(items[0].value, ('previous-' + target.name,), items[2].value)
                            options.SaveAsPreviousVersion = 18000
                            options.SaveAllAsCopy = True
                            if not extension.SaveAs3(str(root / ('previous-' + target.name)), 0, 1, NULL_DISPATCH, options, err, warning):
                                raise RuntimeError(f'2025 save failed: {name}, error {err.value}')
                    finally:
                        sw.CloseDoc(doc.GetTitle)
                    history = sw.VersionHistory(str(target))
                    if not history or not history[-1].startswith('18000['):
                        raise RuntimeError(f'Not a 2025 file: {target}, version history {history}')
                    doc = sw.OpenDoc6(str(target), 1, 1, '', err, warning)
                    if not doc:
                        raise RuntimeError(f'Cannot reopen {target}, error {err.value}')
                    try:
                        bodies = doc.GetBodies2(0, False)  # swSolidBody
                        if not bodies or len(bodies) != 1:
                            raise RuntimeError(f'Expected one solid body in {target}')
                    finally:
                        sw.CloseDoc(doc.GetTitle)
                    files[step.stem + '.SLDPRT'] = target.read_bytes()
                    print(f'{archive}: {target.name}, 2025, one solid', flush=True)
                    target.unlink()
                    step.unlink()
                replacement = root / archive
                with zipfile.ZipFile(replacement, 'w', zipfile.ZIP_DEFLATED) as z:
                    for name, data in files.items():
                        z.writestr(name, data)
                source.write_bytes(replacement.read_bytes())
            sw.SetCurrentWorkingDirectory(original_dir)
    finally:
        sw.SetCurrentWorkingDirectory(original_dir)
        sw.SetUserPreferenceToggle(691, original)

if __name__ == '__main__':
    main()
