using System.Runtime.InteropServices;

namespace ClipboardSync;

/// <summary>
/// Applies a consistent dark theme with the app accent color (#2cb232) to any WinForms Form.
/// Call Apply(this) at the end of each Form constructor (after all controls are added).
/// </summary>
internal static class DarkTheme
{
    internal static readonly Color Background = Color.FromArgb(0x1e, 0x1e, 0x1e);
    internal static readonly Color Surface    = Color.FromArgb(0x2d, 0x2d, 0x2d);
    internal static readonly Color Text       = Color.FromArgb(0xd4, 0xd4, 0xd4);
    internal static readonly Color ButtonBg   = Color.FromArgb(0x3c, 0x3c, 0x3c);
    internal static readonly Color Border     = Color.FromArgb(0x55, 0x55, 0x55);
    internal static readonly Color Accent     = ColorTranslator.FromHtml("#2cb232");

    private const int DwmwaDarkMode    = 20;
    private const int DwmwaDarkModeLeg = 19;

    [DllImport("dwmapi.dll")]
    private static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int pvAttr, int cbAttr);

    internal static void Apply(Form form)
    {
        _ = form.Handle;
        int dark = 1;
        if (DwmSetWindowAttribute(form.Handle, DwmwaDarkMode, ref dark, 4) != 0)
            DwmSetWindowAttribute(form.Handle, DwmwaDarkModeLeg, ref dark, 4);

        form.BackColor = Background;
        form.ForeColor = Text;
        StyleControls(form.Controls);
    }

    private static void StyleControls(Control.ControlCollection controls)
    {
        foreach (Control c in controls)
        {
            switch (c)
            {
                case TextBox tb:
                    tb.BackColor   = Surface;
                    tb.ForeColor   = Text;
                    tb.BorderStyle = BorderStyle.FixedSingle;
                    break;

                case Button btn:
                    if (btn.BackColor == SystemColors.Control)
                    {
                        btn.FlatStyle = FlatStyle.Flat;
                        btn.BackColor = ButtonBg;
                        btn.ForeColor = Text;
                        btn.FlatAppearance.BorderColor = Border;
                        btn.FlatAppearance.BorderSize  = 1;
                    }
                    break;

                case Label lbl:
                    lbl.BackColor = Color.Transparent;
                    if (lbl.ForeColor == SystemColors.ControlText)
                        lbl.ForeColor = Text;
                    break;

                case TableLayoutPanel tlp:
                    tlp.BackColor = Background;
                    break;

                case FlowLayoutPanel flp:
                    flp.BackColor = Surface;
                    break;

                case Panel p:
                    p.BackColor = Background;
                    break;
            }

            if (c.Controls.Count > 0)
                StyleControls(c.Controls);
        }
    }
}
