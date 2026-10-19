import { useEffect, useRef, useState } from 'react';
import { engine } from '../../state/engine';
import type { DeckId } from '../../audio/types';
import { t } from '../../i18n';
import { useWorkspacePopover } from '../../ui/workspace-popover';

type OutputDevices = MediaDevices & { selectAudioOutput?: () => Promise<MediaDeviceInfo> };
export function HeadphoneControls() {
  const { open, panelId, openerRef, panelRef, toggle, close } = useWorkspacePopover();
  const [active, setActive] = useState(false), [busy, setBusy] = useState(false);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]), [output, setOutput] = useState(''), [notice, setNotice] = useState('');
  const [cue, setCue] = useState<Record<DeckId, boolean>>({ A: false, B: false });
  const audio = useRef<HTMLAudioElement | null>(null);
  const supported = typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype;
  function stop() { audio.current?.pause(); if (audio.current) audio.current.srcObject = null; audio.current = null; engine.stopHeadphoneMonitoring(); setActive(false); setCue({ A: false, B: false }); }
  useEffect(() => () => { audio.current?.pause(); if (audio.current) audio.current.srcObject = null; engine.stopHeadphoneMonitoring(); }, []);
  useEffect(() => {
    const media = navigator.mediaDevices;
    if (!media) return;
    const refresh = () => { void media.enumerateDevices().then(list => { const outputs = list.filter(device => device.kind === 'audiooutput' && !['default', 'communications'].includes(device.deviceId)); setDevices(outputs); if (audio.current?.sinkId && !outputs.some(device => device.deviceId === audio.current?.sinkId)) { audio.current.pause(); audio.current.srcObject = null; audio.current = null; engine.stopHeadphoneMonitoring(); setActive(false); setCue({ A: false, B: false }); setNotice('Headphone output disconnected. Choose another output.'); } }).catch(() => setNotice('Audio outputs could not be listed.')); };
    refresh(); media.addEventListener('devicechange', refresh); return () => media.removeEventListener('devicechange', refresh);
  }, []);
  async function choose() {
    setBusy(true); setNotice('');
    try {
      const media = navigator.mediaDevices as OutputDevices;
      if (media?.selectAudioOutput) { const device = await media.selectAudioOutput(); setOutput(device.deviceId); setDevices(current => current.some(item => item.deviceId === device.deviceId) ? current : [...current, device]); }
      else { const outputs = (await media.enumerateDevices()).filter(device => device.kind === 'audiooutput' && !['default', 'communications'].includes(device.deviceId)); setDevices(outputs); if (outputs.length) setOutput(outputs[0].deviceId); else setNotice('No separate output is available. Connect headphones or an audio interface and allow speaker selection in a supporting browser.'); }
    } catch (cause) { setNotice(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }
  async function start() {
    setBusy(true); setNotice('');
    try {
      if (!output || ['default', 'communications'].includes(output)) throw new Error('Choose a separate headphone output first.');
      await engine.initializeFromGesture();
      const element = new Audio(); audio.current?.pause(); audio.current = element;
      await element.setSinkId(output); element.srcObject = engine.getHeadphoneStream(); await element.play(); setActive(true);
    } catch (cause) { stop(); setNotice(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }
  function select(id: DeckId) { try { engine.setHeadphoneCue(id, !cue[id]); setCue(current => ({ ...current, [id]: !current[id] })); } catch (cause) { setNotice(cause instanceof Error ? cause.message : String(cause)); } }
  return <div className="workspace-control"><button ref={openerRef} type="button" aria-label={t('Headphone monitoring')} aria-expanded={open} aria-controls={open ? panelId : undefined} onClick={toggle}>{t('Headphones')}</button>
    {open && <section ref={panelRef} id={panelId} className="workspace-popover" aria-label={t('Headphone monitoring')}><h2>{t('Headphones')}</h2><p>{t('Listen before the crossfader on a separate output. This signal is never added to the master recording. Choose a different device from your main speakers.')}</p>
      {!supported ? <p role="status">{t('Separate headphone output is not supported in this browser. The main mixer still works.')}</p> : <>
        <button type="button" disabled={busy || active} onClick={() => void choose()}>{t('Choose headphone output')}</button>
        <label>{t('Headphone output')}<select aria-label={t('Headphone output')} value={output} disabled={active} onChange={event => setOutput(event.target.value)}><option value="">{t('Choose an output')}</option>{devices.map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `${t('Output')} ${index + 1}`}</option>)}</select></label>
        <button type="button" disabled={busy || !output} onClick={() => active ? stop() : void start()}>{t(active ? 'Stop headphone monitoring' : 'Start headphone monitoring')}</button>
        {(['A', 'B'] as const).map(id => <button type="button" key={id} aria-label={t('Headphone cue') + ' ' + id} aria-pressed={cue[id]} disabled={!active} onClick={() => select(id)}>{t('Listen to deck')} {id}</button>)}
      </>}
      <p role="status">{t(notice)}</p><button type="button" onClick={() => close()}>{t('Close')}</button>
    </section>}
  </div>;
}
