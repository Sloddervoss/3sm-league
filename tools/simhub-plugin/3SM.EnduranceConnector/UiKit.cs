using System;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Markup;
using System.Windows.Media;
using System.Windows.Media.Animation;

namespace ThreeSM.EnduranceConnector
{
    // Eigen design-system in DNR-achtige stijl (dark + oranje accent): tokens en
    // herbruikbare componenten. Originele implementatie — geen DNR-code gekopieerd.
    public static class UiKit
    {
        // ---- tokens ----
        public static readonly SolidColorBrush Bg = B("#0E0F13");
        public static readonly SolidColorBrush Surface = B("#16181F");
        public static readonly SolidColorBrush SurfaceAlt = B("#1C1F29");
        public static readonly SolidColorBrush SurfaceHi = B("#232734");
        public static readonly SolidColorBrush Border = B("#2A2E3C");
        public static readonly SolidColorBrush Text = B("#F2F4F8");
        public static readonly SolidColorBrush Muted = B("#97A0B5");
        public static readonly SolidColorBrush Accent = B("#FF6B1A");
        public static readonly SolidColorBrush AccentSoft = B("#FFA169");
        public static readonly SolidColorBrush Ok = B("#3DD68C");
        public static readonly SolidColorBrush Warn = B("#FFC24B");
        public static readonly SolidColorBrush Danger = B("#FF5C6C");

        public static SolidColorBrush B(string hex) { return new SolidColorBrush((Color)ColorConverter.ConvertFromString(hex)); }
        public static Thickness T(double all) { return new Thickness(all); }
        public static Thickness T(double h, double v) { return new Thickness(h, v, h, v); }
        public static Thickness T(double left, double top, double right, double bottom) { return new Thickness(left, top, right, bottom); }

        // ---- tekst ----
        public static TextBlock Title(string text) { return new TextBlock { Text = text, FontSize = 22, FontWeight = FontWeights.Bold, Foreground = Text }; }
        public static TextBlock Sub(string text) { return new TextBlock { Text = text, FontSize = 12.5, Foreground = Muted, TextWrapping = TextWrapping.Wrap }; }
        public static TextBlock Eyebrow(string text) { return new TextBlock { Text = (text ?? string.Empty).ToUpperInvariant(), FontSize = 11, FontWeight = FontWeights.Bold, Foreground = AccentSoft }; }
        public static TextBlock Label(string text) { return new TextBlock { Text = text, Foreground = Muted, FontSize = 12.5, VerticalAlignment = VerticalAlignment.Center }; }

        public static Border Header(string title, string subtitle)
        {
            var stack = new StackPanel { Margin = T(0, 0, 0, 16) };
            stack.Children.Add(Title(title));
            if (!string.IsNullOrEmpty(subtitle)) { var s = Sub(subtitle); s.Margin = T(0, 4, 0, 0); stack.Children.Add(s); }
            return new Border { Child = stack };
        }

        // ---- card ----
        public static Border Card(UIElement content, string eyebrow = null)
        {
            var stack = new StackPanel();
            if (!string.IsNullOrEmpty(eyebrow)) { var e = Eyebrow(eyebrow); e.Margin = T(0, 0, 0, 10); stack.Children.Add(e); }
            stack.Children.Add(content);
            return new Border { Background = Surface, BorderBrush = Border, BorderThickness = T(1), CornerRadius = new CornerRadius(12), Padding = T(16), Margin = T(0, 0, 0, 12), Child = stack };
        }

        // ---- buttons (getemplatet voor ronde hoeken + hover) ----
        private static ControlTemplate ButtonTemplate(string bg, string fg, string hover, string border)
        {
            var borderExtra = border == null ? string.Empty : " BorderBrush=\"" + border + "\" BorderThickness=\"1\"";
            var xaml =
                "<ControlTemplate xmlns=\"http://schemas.microsoft.com/winfx/2006/xaml/presentation\" " +
                "xmlns:x=\"http://schemas.microsoft.com/winfx/2006/xaml\" TargetType=\"Button\">" +
                "<Border x:Name=\"b\" CornerRadius=\"8\" Background=\"" + bg + "\"" + borderExtra + " Padding=\"14,8\">" +
                "<ContentPresenter HorizontalAlignment=\"Center\" VerticalAlignment=\"Center\"/>" +
                "</Border>" +
                "<ControlTemplate.Triggers>" +
                "<Trigger Property=\"IsMouseOver\" Value=\"True\"><Setter TargetName=\"b\" Property=\"Background\" Value=\"" + hover + "\"/></Trigger>" +
                "<Trigger Property=\"IsEnabled\" Value=\"False\"><Setter TargetName=\"b\" Property=\"Opacity\" Value=\"0.45\"/></Trigger>" +
                "</ControlTemplate.Triggers>" +
                "</ControlTemplate>";
            return (ControlTemplate)XamlReader.Parse(xaml);
        }

        public static Button Primary(string text)
        {
            return new Button { Content = text, Template = ButtonTemplate("#FF6B1A", "#FFFFFF", "#FF8138", null), FontWeight = FontWeights.SemiBold, Cursor = Cursors.Hand, Foreground = Brushes.White, Margin = T(0, 0, 8, 8) };
        }

        public static Button Secondary(string text)
        {
            return new Button { Content = text, Template = ButtonTemplate("#1C1F29", "#F2F4F8", "#262B3A", "#2A2E3C"), Cursor = Cursors.Hand, Foreground = Text, Margin = T(0, 0, 8, 8) };
        }

        public static Button DangerButton(string text)
        {
            return new Button { Content = text, Template = ButtonTemplate("#2A1518", "#FF8A96", "#3A1B20", "#5A2A30"), Cursor = Cursors.Hand, Foreground = Danger, Margin = T(0, 0, 8, 8) };
        }

        // ---- checkbox ----
        public static CheckBox Toggle(string label, bool initial, Action<bool> onChange)
        {
            var cb = new CheckBox { Content = label, IsChecked = initial, Foreground = Text, Margin = T(0, 0, 16, 8), VerticalContentAlignment = VerticalAlignment.Center };
            cb.Checked += delegate { onChange(true); };
            cb.Unchecked += delegate { onChange(false); };
            return cb;
        }

        // ---- invoer ----
        public static TextBox Field(double width = 220)
        {
            return new TextBox { Width = width, Padding = T(10, 7), Background = Bg, Foreground = Text, BorderBrush = Border, BorderThickness = T(1), HorizontalAlignment = HorizontalAlignment.Left, CaretBrush = Text };
        }

        public static ComboBox Combo(bool editable = false, double width = 220)
        {
            return new ComboBox { IsEditable = editable, Width = width, HorizontalAlignment = HorizontalAlignment.Left, Background = SurfaceAlt, Foreground = Text, BorderBrush = Border, BorderThickness = T(1) };
        }

        public static Grid Row(string label, UIElement control)
        {
            var grid = new Grid { Margin = T(0, 4, 0, 10) };
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(160) });
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            var text = Label(label);
            Grid.SetColumn(text, 0); Grid.SetColumn(control, 1);
            grid.Children.Add(text); grid.Children.Add(control);
            return grid;
        }

        public static Grid InfoRow(string label, string value)
        {
            var grid = new Grid { Margin = T(0, 3, 0, 3) };
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(160) });
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            var l = Label(label);
            var v = new TextBlock { Text = value, Foreground = Text, FontSize = 12.5, TextWrapping = TextWrapping.Wrap };
            Grid.SetColumn(l, 0); Grid.SetColumn(v, 1);
            grid.Children.Add(l); grid.Children.Add(v);
            return grid;
        }

        public static Border Badge(string text, Brush colour)
        {
            return new Border
            {
                Background = colour, CornerRadius = new CornerRadius(10), Padding = T(10, 4), HorizontalAlignment = HorizontalAlignment.Left,
                Child = new TextBlock { Text = text, Foreground = B("#0E0F13"), FontSize = 11.5, FontWeight = FontWeights.Bold },
            };
        }

        // ---- genavigeerde sectie (geanimeerde expander) ----
        // ---- navigatie-item (sidebar) ----
        public static ControlTemplate NavTemplate()
        {
            var xaml =
                "<ControlTemplate xmlns=\"http://schemas.microsoft.com/winfx/2006/xaml/presentation\" " +
                "xmlns:x=\"http://schemas.microsoft.com/winfx/2006/xaml\" TargetType=\"RadioButton\">" +
                "<Grid>" +
                "<Border x:Name=\"bg\" CornerRadius=\"8\" Background=\"Transparent\" Padding=\"12,10\"><ContentPresenter VerticalAlignment=\"Center\"/></Border>" +
                "<Rectangle x:Name=\"bar\" Width=\"3\" HorizontalAlignment=\"Left\" Fill=\"#FF6B1A\" RadiusX=\"1.5\" RadiusY=\"1.5\" Opacity=\"0\"/>" +
                "</Grid>" +
                "<ControlTemplate.Triggers>" +
                "<Trigger Property=\"IsMouseOver\" Value=\"True\"><Setter TargetName=\"bg\" Property=\"Background\" Value=\"#1C1F29\"/></Trigger>" +
                "<Trigger Property=\"IsChecked\" Value=\"True\"><Setter TargetName=\"bg\" Property=\"Background\" Value=\"#232734\"/><Setter TargetName=\"bar\" Property=\"Opacity\" Value=\"1\"/><Setter Property=\"Foreground\" Value=\"#F2F4F8\"/></Trigger>" +
                "</ControlTemplate.Triggers>" +
                "</ControlTemplate>";
            return (ControlTemplate)XamlReader.Parse(xaml);
        }

        public static RadioButton NavItem(string icon, string label, bool selected, Action onClick)
        {
            var rb = new RadioButton
            {
                GroupName = "nav",
                Content = icon + "    " + label,
                IsChecked = selected,
                Foreground = Muted,
                FontSize = 13,
                Margin = T(0, 2, 0, 2),
                HorizontalContentAlignment = HorizontalAlignment.Left,
                Cursor = Cursors.Hand,
                Template = NavTemplate(),
            };
            rb.Checked += delegate { if (onClick != null) onClick(); };
            return rb;
        }

        // ---- animaties ----
        public static void AnimateIn(UIElement element, double fromY = 8, double ms = 220)
        {
            if (element == null) return;
            element.Opacity = 0;
            var translate = new TranslateTransform(0, fromY);
            element.RenderTransform = translate;
            var ease = new CubicEase { EasingMode = EasingMode.EaseOut };
            var fade = new DoubleAnimation(0, 1, TimeSpan.FromMilliseconds(ms)) { EasingFunction = ease };
            var slide = new DoubleAnimation(fromY, 0, TimeSpan.FromMilliseconds(ms)) { EasingFunction = ease };
            element.BeginAnimation(UIElement.OpacityProperty, fade);
            translate.BeginAnimation(TranslateTransform.YProperty, slide);
        }

        // ---- inklapbare sectie ----
        public static Expander Section(string title, UIElement content)
        {
            return new Expander
            {
                Header = new TextBlock { Text = title, Foreground = Text, FontSize = 13, FontWeight = FontWeights.SemiBold },
                Content = new Border { Child = content, Margin = T(4, 8, 0, 0) },
                Foreground = Text,
                Margin = T(0, 2, 0, 6),
                IsExpanded = false,
            };
        }
    }
}
