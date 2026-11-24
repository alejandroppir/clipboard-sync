//! How many characters a user copies: today, this week, this month and ever. Only the numbers, for the admin.
//!
//! They travel in the user's clipboard document, in the same write as the text, so they cost no extra write.
//! Each number starts again when its period changes; no history is kept.

use jiff::civil::Date;
use serde::{Deserialize, Serialize};
use specta::Type;

/// `u32` because TypeScript cannot hold every bigger number; it counts up to 4000 million characters.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Usage {
    /// `2026-11-24`
    day: String,
    day_chars: u32,
    /// `2026-W48`
    week: String,
    week_chars: u32,
    /// `2026-11`
    month: String,
    month_chars: u32,
    total_chars: u32,
}

/// What the admin sees.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Type)]
pub struct UsageSummary {
    pub today: u32,
    pub week: u32,
    pub month: u32,
    pub total: u32,
}

impl Usage {
    /// The numbers after copying `chars` more on `today`.
    pub fn plus(&self, chars: usize, today: Date) -> Self {
        let chars = u32::try_from(chars).unwrap_or(u32::MAX);
        let [day, week, month] = periods(today);
        let count = |same: bool, counted: u32| if same { counted.saturating_add(chars) } else { chars };
        Self {
            day_chars: count(self.day == day, self.day_chars),
            week_chars: count(self.week == week, self.week_chars),
            month_chars: count(self.month == month, self.month_chars),
            total_chars: self.total_chars.saturating_add(chars),
            day,
            week,
            month,
        }
    }

    /// The numbers as of `today`: the ones of a past period are zero.
    pub fn summary(&self, today: Date) -> UsageSummary {
        let [day, week, month] = periods(today);
        let current = |same: bool, counted: u32| if same { counted } else { 0 };
        UsageSummary {
            today: current(self.day == day, self.day_chars),
            week: current(self.week == week, self.week_chars),
            month: current(self.month == month, self.month_chars),
            total: self.total_chars,
        }
    }

    /// Keeps the newest of two counts: an older document, or one without counts, must not undo the others.
    pub fn newest(self, other: Self) -> Self {
        if other.total_chars > self.total_chars { other } else { self }
    }
}

fn periods(date: Date) -> [String; 3] {
    let week = date.iso_week_date();
    [date.to_string(), format!("{}-W{:02}", week.year(), week.week()), date.strftime("%Y-%m").to_string()]
}

#[cfg(test)]
mod tests {
    use super::*;
    use jiff::civil::date;

    #[test]
    fn each_period_starts_again() {
        let usage = Usage::default().plus(10, date(2026, 11, 29)).plus(5, date(2026, 11, 29));
        assert_eq!(usage.summary(date(2026, 11, 29)), UsageSummary { today: 15, week: 15, month: 15, total: 15 });

        // Monday: another day and week, the same month.
        let usage = usage.plus(1, date(2026, 11, 30));
        assert_eq!(usage.summary(date(2026, 11, 30)), UsageSummary { today: 1, week: 1, month: 16, total: 16 });

        // Nothing copied since: what is shown starts again even if the document has not changed.
        assert_eq!(usage.summary(date(2026, 12, 1)), UsageSummary { today: 0, week: 1, month: 0, total: 16 });
    }

    #[test]
    fn the_week_of_new_year_is_one() {
        let usage = Usage::default().plus(3, date(2026, 12, 31)).plus(4, date(2027, 1, 1));
        assert_eq!(usage.summary(date(2027, 1, 1)), UsageSummary { today: 4, week: 7, month: 4, total: 7 });
    }

    #[test]
    fn a_document_without_counts_does_not_undo_them() {
        let usage = Usage::default().plus(10, date(2026, 11, 29));
        assert_eq!(usage.clone().newest(Usage::default()), usage);
        assert_eq!(Usage::default().newest(usage.clone()), usage);
    }
}
