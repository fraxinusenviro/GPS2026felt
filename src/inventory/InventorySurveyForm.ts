/**
 * Survey metadata entry modal (Survey ID, Site, Surveyor, Locale, County, Date,
 * Report Note). Pre-fills from localStorage and remembers entries between
 * surveys. Ported from NSINV `openMetadata` / meta-prefs helpers.
 */
import { EventBus } from '../utils/EventBus';
import { escapeHtml } from './inventorySurvey';

const PREFS_KEY = 'inv_meta_prefs';

export interface SurveyMeta {
  surveyID: string;
  siteName: string;
  surveyor: string;
  locale: string;
  county: string;
  date: string;
  reportNote: string;
}

interface MetaPrefs { surveyor?: string; site?: string; surveyid?: string; locale?: string; county?: string; }

/** Options for opening the form in edit mode (vs. the default "new survey" flow). */
export interface SurveyFormOptions {
  title?: string;
  confirmLabel?: string;
  initial?: Partial<SurveyMeta>;   // prefill values (overrides remembered prefs)
}

function loadPrefs(): MetaPrefs {
  try { return JSON.parse(localStorage.getItem(PREFS_KEY) || '{}'); } catch { return {}; }
}
function savePrefs(p: MetaPrefs): void {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch { /* ignore */ }
}

export class InventorySurveyForm {
  open(onStart: (meta: SurveyMeta) => void, options: SurveyFormOptions = {}): void {
    const prefs = loadPrefs();
    const today = new Date().toISOString().slice(0, 10);
    const init = options.initial ?? {};
    const field = (id: string, label: string, value: string, type = 'text', required = true) => `
      <label class="inv-form-row">
        <span class="inv-form-label">${escapeHtml(label)}${required ? ' *' : ''}</span>
        <input id="${id}" class="inv-input" type="${type}" value="${escapeHtml(value)}" />
      </label>`;

    EventBus.emit('show-modal', {
      title: options.title ?? 'New Inventory Survey',
      html: `
        <div class="inv-survey-form">
          ${field('inv-f-surveyor', 'Surveyor', init.surveyor ?? prefs.surveyor ?? '')}
          ${field('inv-f-site', 'Site Name', init.siteName ?? prefs.site ?? '')}
          ${field('inv-f-surveyid', 'Survey ID', init.surveyID ?? prefs.surveyid ?? '')}
          ${field('inv-f-locale', 'Locale', init.locale ?? prefs.locale ?? '')}
          ${field('inv-f-county', 'County', init.county ?? prefs.county ?? '')}
          ${field('inv-f-date', 'Date', init.date ?? today, 'date')}
          <label class="inv-form-row">
            <span class="inv-form-label">Report Note</span>
            <textarea id="inv-f-note" class="inv-input" rows="2">${escapeHtml(init.reportNote ?? '')}</textarea>
          </label>
        </div>`,
      confirmLabel: options.confirmLabel ?? 'Start Survey',
      cancelLabel: 'Cancel',
      onConfirm: () => {
        const val = (id: string) => (document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement | null)?.value.trim() || '';
        const meta: SurveyMeta = {
          surveyor: val('inv-f-surveyor'),
          siteName: val('inv-f-site'),
          surveyID: val('inv-f-surveyid'),
          locale: val('inv-f-locale'),
          county: val('inv-f-county'),
          date: val('inv-f-date') || today,
          reportNote: val('inv-f-note'),
        };
        savePrefs({ surveyor: meta.surveyor, site: meta.siteName, surveyid: meta.surveyID, locale: meta.locale, county: meta.county });
        onStart(meta);
      },
    });

    requestAnimationFrame(() => (document.getElementById('inv-f-surveyor') as HTMLInputElement | null)?.focus());
  }
}
