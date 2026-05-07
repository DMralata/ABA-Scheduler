export const clients = [
  { id: "C-001", initials: "LA", name: "Anderson, Lucas", ageDob: "9y · Apr 19, 2017", insurance: "Aetna", authUsed: 14, authTotal: 20, preferences: [], status: "Active" },
  { id: "C-002", initials: "SB", name: "Brown, Sofia", ageDob: "10y · Sep 2, 2015", insurance: "Kaiser", authUsed: 18, authTotal: 20, preferences: [], status: "Active" },
  { id: "C-003", initials: "BC", name: "Clark, Benjamin", ageDob: "11y · Sep 21, 2014", insurance: "Cigna", authUsed: 12, authTotal: 15, preferences: [], status: "Active" },
  { id: "C-004", initials: "OD", name: "Davis, Olivia", ageDob: "7y · Jan 29, 2019", insurance: "Blue Cross Blue Shield", authUsed: 18.5, authTotal: 20, preferences: ["Female only"], status: "Active" },
  { id: "C-005", initials: "MG", name: "Gonzalez, Mateo", ageDob: "7y · Dec 4, 2018", insurance: "Medicaid", authUsed: 6, authTotal: 25, preferences: ["Spanish"], status: "Active" },
  { id: "C-006", initials: "EH", name: "Harris, Ethan", ageDob: "5y · Jun 16, 2020", insurance: "Blue Cross Blue Shield", authUsed: 9, authTotal: 15, preferences: [], status: "Active" },
  { id: "C-007", initials: "MJ", name: "Jackson, Mia", ageDob: "10y · Nov 29, 2015", insurance: "Kaiser", authUsed: 22, authTotal: 25, preferences: [], status: "Active" },
  { id: "C-008", initials: "EJ", name: "Johnson, Emma", ageDob: "9y · Jul 21, 2016", insurance: "United Healthcare", authUsed: 11, authTotal: 20, preferences: ["Female only"], status: "Active" },
  { id: "C-009", initials: "JL", name: "Lee, James", ageDob: "7y · Jul 8, 2018", insurance: "Aetna", authUsed: 15, authTotal: 20, preferences: [], status: "Active" },
  { id: "C-010", initials: "AL", name: "Lewis, Amelia", ageDob: "5y · Jan 7, 2021", insurance: "Medicaid", authUsed: 8, authTotal: 15, preferences: [], status: "Active" },
  { id: "C-011", initials: "AM", name: "Martinez, Aiden", ageDob: "5y · May 13, 2020", insurance: "Medicaid", authUsed: 4, authTotal: 25, preferences: ["Spanish"], status: "Active" },
];

export const providers = [
  { id: "P-001", initials: "DB", name: "Brooks, Devon", position: "RBT", level: "Level I", languages: ["EN"], availability: "Mon–Fri 8am–4pm", utilization: 78, status: "Active" },
  { id: "P-002", initials: "AC", name: "Chen, Ashley", position: "RBT", level: "Level III", languages: ["EN"], availability: "Mon–Fri 9am–5pm", utilization: 88, status: "Active" },
  { id: "P-003", initials: "TJ", name: "Johnson, Tyler", position: "RBT", level: "Level I", languages: ["EN"], availability: "Mon–Fri 9am–5pm", utilization: 72, status: "Active" },
  { id: "P-004", initials: "JK", name: "Kim, Jordan", position: "BCaBA", level: "—", languages: ["EN"], availability: "Mon–Fri 8am–4pm", utilization: 45, status: "Active" },
  { id: "P-005", initials: "CO", name: "O’Brien, Chris", position: "RBT", level: "Level III", languages: ["EN"], availability: "Mon–Fri 9am–5pm", utilization: 82, status: "Active" },
  { id: "P-006", initials: "DP", name: "Park, David", position: "BCBA", level: "—", languages: ["EN"], availability: "Mon–Fri 8am–4pm", utilization: 40, status: "Active" },
  { id: "P-007", initials: "SP", name: "Patel, Sarah", position: "BCBA", level: "—", languages: ["EN", "ES"], availability: "Mon–Fri 9am–5pm", utilization: 75, status: "Active" },
  { id: "P-008", initials: "AR", name: "Rivera, Alex", position: "RBT", level: "Level II", languages: ["EN", "ES"], availability: "Mon–Fri 8am–4pm", utilization: 68, status: "Active" },
];

export const threads = [
  { id: "T-001", initials: "JS", name: "Jordan Smith", role: "RBT", preview: "Thanks for reaching out! I can cover Tuesday’s 4:00 PM session.", timestamp: "10:31 AM", unreadCount: 2, tags: ["RBT", "Coverage needed"], selected: true },
  { id: "T-002", initials: "SJ", name: "Sarah Johnson", role: "Provider", preview: "I have a scheduling conflict on Wednesday at 4pm for Liam Parker.", timestamp: "10:24 AM", unreadCount: 1, tags: ["Coverage"] },
  { id: "T-003", initials: "MT", name: "Maria Torres", role: "Caregiver", preview: "Will the session still be at our home this week?", timestamp: "8:42 AM", unreadCount: 1, tags: ["Client"] },
  { id: "T-004", initials: "AC", name: "Ashley Chen", role: "RBT", preview: "Confirmed. I can keep the 9 AM session.", timestamp: "Yesterday", unreadCount: 0, tags: ["Provider"] },
];
