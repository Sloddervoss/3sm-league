using System;
using System.Windows;
using System.Windows.Markup;

namespace ThreeSM.EnduranceConnector
{
    // Eigen XAML-thema (dark + oranje accent) dat de standaard WPF-controls
    // restyled: CheckBox, TextBox, ScrollBar. Wordt op het instellingenpaneel
    // toegepast (lokale scope), zodat SimHub's eigen UI niet verandert.
    // Originele XAML — niet gekopieerd van DNR.
    public static class Theme
    {
        public const string Xaml = @"
<ResourceDictionary xmlns=""http://schemas.microsoft.com/winfx/2006/xaml/presentation""
                    xmlns:x=""http://schemas.microsoft.com/winfx/2006/xaml"">

  <SolidColorBrush x:Key=""3sm.Bg"" Color=""#0E0F13""/>
  <SolidColorBrush x:Key=""3sm.Surface"" Color=""#16181F""/>
  <SolidColorBrush x:Key=""3sm.SurfaceAlt"" Color=""#1C1F29""/>
  <SolidColorBrush x:Key=""3sm.Border"" Color=""#2A2E3C""/>
  <SolidColorBrush x:Key=""3sm.Text"" Color=""#F2F4F8""/>
  <SolidColorBrush x:Key=""3sm.Muted"" Color=""#97A0B5""/>
  <SolidColorBrush x:Key=""3sm.Accent"" Color=""#FF6B1A""/>

  <!-- CheckBox -->
  <Style TargetType=""CheckBox"">
    <Setter Property=""Foreground"" Value=""{StaticResource 3sm.Text}""/>
    <Setter Property=""Template"">
      <Setter.Value>
        <ControlTemplate TargetType=""CheckBox"">
          <StackPanel Orientation=""Horizontal"" Background=""Transparent"">
            <Border x:Name=""box"" Width=""18"" Height=""18"" CornerRadius=""5"" Background=""{StaticResource 3sm.Bg}"" BorderBrush=""{StaticResource 3sm.Border}"" BorderThickness=""1"" VerticalAlignment=""Center"">
              <Path x:Name=""check"" Data=""M 3,9 L 7,13 L 14,4"" Stroke=""White"" StrokeThickness=""2"" Visibility=""Collapsed"" VerticalAlignment=""Center"" HorizontalAlignment=""Center""/>
            </Border>
            <ContentPresenter Margin=""9,0,0,0"" VerticalAlignment=""Center""/>
          </StackPanel>
          <ControlTemplate.Triggers>
            <Trigger Property=""IsChecked"" Value=""True"">
              <Setter TargetName=""box"" Property=""Background"" Value=""{StaticResource 3sm.Accent}""/>
              <Setter TargetName=""box"" Property=""BorderBrush"" Value=""{StaticResource 3sm.Accent}""/>
              <Setter TargetName=""check"" Property=""Visibility"" Value=""Visible""/>
            </Trigger>
            <Trigger Property=""IsMouseOver"" Value=""True"">
              <Setter TargetName=""box"" Property=""BorderBrush"" Value=""{StaticResource 3sm.Accent}""/>
            </Trigger>
          </ControlTemplate.Triggers>
        </ControlTemplate>
      </Setter.Value>
    </Setter>
  </Style>

  <!-- TextBox -->
  <Style TargetType=""TextBox"">
    <Setter Property=""Background"" Value=""{StaticResource 3sm.Bg}""/>
    <Setter Property=""Foreground"" Value=""{StaticResource 3sm.Text}""/>
    <Setter Property=""CaretBrush"" Value=""{StaticResource 3sm.Accent}""/>
    <Setter Property=""BorderBrush"" Value=""{StaticResource 3sm.Border}""/>
    <Setter Property=""BorderThickness"" Value=""1""/>
    <Setter Property=""Padding"" Value=""9,7""/>
    <Setter Property=""Template"">
      <Setter.Value>
        <ControlTemplate TargetType=""TextBox"">
          <Border x:Name=""b"" CornerRadius=""8"" Background=""{TemplateBinding Background}"" BorderBrush=""{TemplateBinding BorderBrush}"" BorderThickness=""{TemplateBinding BorderThickness}"">
            <ScrollViewer x:Name=""PART_ContentHost"" Margin=""{TemplateBinding Padding}"" VerticalAlignment=""Center""/>
          </Border>
          <ControlTemplate.Triggers>
            <Trigger Property=""IsKeyboardFocused"" Value=""True""><Setter TargetName=""b"" Property=""BorderBrush"" Value=""{StaticResource 3sm.Accent}""/></Trigger>
          </ControlTemplate.Triggers>
        </ControlTemplate>
      </Setter.Value>
    </Setter>
  </Style>

  <!-- ScrollBar (dun) -->
  <Style TargetType=""ScrollBar"">
    <Setter Property=""Width"" Value=""10""/>
    <Setter Property=""Background"" Value=""Transparent""/>
    <Setter Property=""Template"">
      <Setter.Value>
        <ControlTemplate TargetType=""ScrollBar"">
          <Grid Background=""Transparent"">
            <Track x:Name=""PART_Track"" IsDirectionReversed=""True"">
              <Track.Thumb>
                <Thumb>
                  <Thumb.Template>
                    <ControlTemplate TargetType=""Thumb"">
                      <Border CornerRadius=""4"" Background=""#3A4053"" Margin=""2,0""/>
                    </ControlTemplate>
                  </Thumb.Template>
                </Thumb>
              </Track.Thumb>
              <Track.IncreaseRepeatButton>
                <RepeatButton Command=""ScrollBar.PageDownCommand"" Opacity=""0"" Focusable=""False""/>
              </Track.IncreaseRepeatButton>
              <Track.DecreaseRepeatButton>
                <RepeatButton Command=""ScrollBar.PageUpCommand"" Opacity=""0"" Focusable=""False""/>
              </Track.DecreaseRepeatButton>
            </Track>
          </Grid>
        </ControlTemplate>
      </Setter.Value>
    </Setter>
  </Style>

  <!-- Expander (header + chevron) -->
  <Style TargetType=""Expander"">
    <Setter Property=""Foreground"" Value=""{StaticResource 3sm.Text}""/>
    <Setter Property=""Template"">
      <Setter.Value>
        <ControlTemplate TargetType=""Expander"">
          <StackPanel>
            <ToggleButton IsChecked=""{Binding IsExpanded, RelativeSource={RelativeSource TemplatedParent}}"" Cursor=""Hand"" Focusable=""False"">
              <ToggleButton.Template>
                <ControlTemplate TargetType=""ToggleButton"">
                  <Border Background=""{StaticResource 3sm.SurfaceAlt}"" CornerRadius=""8"" Padding=""12,9"">
                    <Grid>
                      <ContentPresenter Content=""{Binding Header, RelativeSource={RelativeSource AncestorType=Expander}}"" VerticalAlignment=""Center""/>
                      <Path Data=""M 0,0 L 5,5 L 10,0"" Stroke=""{StaticResource 3sm.Muted}"" StrokeThickness=""2"" HorizontalAlignment=""Right"" VerticalAlignment=""Center""/>
                    </Grid>
                  </Border>
                </ControlTemplate>
              </ToggleButton.Template>
            </ToggleButton>
            <ContentPresenter x:Name=""exp"" Visibility=""Collapsed""/>
          </StackPanel>
          <ControlTemplate.Triggers>
            <Trigger Property=""IsExpanded"" Value=""True""><Setter TargetName=""exp"" Property=""Visibility"" Value=""Visible""/></Trigger>
          </ControlTemplate.Triggers>
        </ControlTemplate>
      </Setter.Value>
    </Setter>
  </Style>

</ResourceDictionary>
";

        // Parseert het thema; gooit bij een fout (dan valt de UI terug op de default-stijl).
        public static ResourceDictionary Dictionary()
        {
            return (ResourceDictionary)XamlReader.Parse(Xaml);
        }
    }
}
