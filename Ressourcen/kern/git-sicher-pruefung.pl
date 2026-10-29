#!/usr/bin/perl
# git-sicher-pruefung.pl — Erlaubnisliste für die Repo-Konfiguration (Teil von git-sicher; Kern-Umzug P4, Sicherheit).
#
# Aufruf: git-sicher-pruefung.pl <git> <ordner> [--alle]
# Mit --alle (Befund der Umstellung, Paket P7a): nicht beim ersten verbotenen Schlüssel abbrechen, sondern ALLE verbotenen Schlüsselnamen
# ausgeben (je eine Zeile `REFUSE\t<Schlüssel>`, jeder Name einmal, in der Reihenfolge der Konfiguration), dann Exit 1; ohne Fund `OK` und Exit 0.
# Auch dann nur Namen, nie Werte. Der Normalmodus (ohne --alle), den git-sicher benutzt, bleibt unverändert.
# Liest ALLE Einträge des Repo-Scopes (local, worktree — auch alles, was per include.path/includeIf dazukäme: diese Schlüssel sind selbst
# verboten) mit `git config --list --show-scope --includes -z` (NUL-getrennt, Schlüssel und Wert sauber getrennt: kein Muster über ganze
# Zeilen, ein „=“ im Unterabschnitt täuscht nichts vor). JEDER lokale Schlüssel muss auf der Erlaubnisliste stehen und einen zulässigen Wert
# haben, sonst Abbruch mit Exit 1 und der Ausgabe `REFUSE\t<Schlüssel>` (nur der Name, nie der Wert). Alles Unbekannte ist verboten
# (fail-closed): so entscheidet nicht eine Liste bekannter Programm-Schlüssel, sondern eine Liste harmloser. Scheitert `git config`
# selbst, ist das ebenfalls ein Abbruch.
# Ausgabe bei Erfolg: `OK`, dazu `HOOKSPATH\t<Wert>` (letzter core.hooksPath des Repos, die Entschärfung entscheidet git-sicher).
#
# Wahrheitswerte werden bewusst enger gelesen als von git (nur true/false, yes/no, on/off, 0/1): git deutet jede Zahl ≠ 0 als „wahr“ und
# einen Schlüssel ohne Wert ebenso („promisor = 2“, „bare“ ohne =); beides gilt hier als ungültig. Nur lokale Schlüssel zählen; system,
# global und command sind die Einstellungen des Nutzers selbst (http.*, credential.helper … stehen dort richtig und bleiben unangetastet).
use strict;
use warnings;

my $alle = grep { $_ eq "--alle" } @ARGV;
my ($git, $ordner) = grep { $_ ne "--alle" } @ARGV;
exit 2 unless defined $git && defined $ordner;

my $pid = open(my $fh, "-|");
exit 2 unless defined $pid;
if ($pid == 0) {
    open(STDERR, ">", "/dev/null");
    exec { $git } $git, "-C", $ordner, "-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null", "-c", "protocol.ext.allow=never",
        "config", "--list", "--show-scope", "--includes", "-z";
    exit 127;
}
my $roh = do { local $/; <$fh> };
$roh = "" unless defined $roh;
close($fh);
if ($? != 0) { print "REFUSE\t(git config --list schlug fehl)\n"; exit 1; }

my @t = split(/\0/, $roh, -1);
pop @t if @t && $t[-1] eq "";
if (@t % 2) { print "REFUSE\t(unerwartete Ausgabe von git config)\n"; exit 1; }

sub wahr { my $w = shift; return defined $w && $w =~ /^(true|false|yes|no|on|off|0|1)$/i; }
sub falsch { my $w = shift; return defined $w && $w =~ /^(false|no|off|0)$/i; }
sub text { my $w = shift; return defined $w && $w !~ /[\x00-\x08\x0b-\x1f\x7f]/; }
sub url_ok {
    my $u = shift;
    return 0 unless defined $u && length $u && $u !~ /[\x00-\x1f\x7f]/ && $u !~ /^-/;
    return 1 if $u =~ m{^https://[A-Za-z0-9_\[][^\s/]*(/\S*)?$};
    return 1 if $u =~ m{^ssh://[A-Za-z0-9_\[][^\s/]*(/\S*)?$};
    return 1 if $u =~ m{^[A-Za-z0-9_][A-Za-z0-9_.-]*\@[A-Za-z0-9\[][A-Za-z0-9_.:\]-]*:\S*$} && $u !~ /::/;
    # Lokale Adressen (absoluter Pfad, file:///) starten beim Senden die Hooks des Ziel-Repos und schreiben in fremde lokale Repositories
    # (git leert für den lokalen Transport GIT_CONFIG_PARAMETERS, die Entschärfung per -c gilt dort nicht): nur in der Testumgebung erlaubt.
    return 0 unless $ENV{KORTEX_KERN_UNSTABIL_ERLAUBT} && $ENV{KORTEX_KERN_UNSTABIL_ERLAUBT} eq "1" or $ENV{BRAIN_TESTMODUS} && $ENV{BRAIN_TESTMODUS} eq "1";
    return 1 if $u =~ m{^/[^\x00-\x1f]*$} && $u !~ m{^//};
    return 1 if $u =~ m{^file:///[^\x00-\x1f]*$};
    return 0;
}
# Name und Adresse landen in Reflog-Zeilen und Commit-Köpfen: keine Zeichen, die eine Shell oder ein Format deuten könnte
sub person_ok { my $w = shift; return defined $w && length $w && $w !~ /[;\$`|&<>\\\x00-\x1f\x7f]/; }

# Schlüssel ohne Unterabschnitt: "abschnitt.variable" → Prüfung des Werts
my %ohne = (
    "core.repositoryformatversion" => sub { $_[0] =~ /^[01]$/ },
    "core.filemode"                => \&wahr,
    "core.bare"                    => \&falsch,
    "core.logallrefupdates"        => sub { wahr($_[0]) || (defined $_[0] && lc $_[0] eq "always") },
    "core.ignorecase"              => \&wahr,
    "core.precomposeunicode"       => \&wahr,
    "core.symlinks"                => \&wahr,
    "core.longpaths"               => \&wahr,
    "core.autocrlf"                => sub { wahr($_[0]) || (defined $_[0] && lc $_[0] eq "input") },
    "core.eol"                     => sub { defined $_[0] && $_[0] =~ /^(lf|crlf|native)$/i },
    "core.safecrlf"                => sub { wahr($_[0]) || (defined $_[0] && lc $_[0] eq "warn") },
    "core.quotepath"               => \&wahr,
    "core.hookspath"               => \&text,    # wird von git-sicher per -c überschrieben, außer es ist der Hook-Ordner des Kerns
    "user.name"                    => \&person_ok,
    "user.email"                   => \&person_ok,
    "pull.rebase"                  => sub { wahr($_[0]) || (defined $_[0] && $_[0] =~ /^(merges|interactive)$/i) },
    "pull.ff"                      => sub { wahr($_[0]) || (defined $_[0] && lc $_[0] eq "only") },
    "merge.ff"                     => sub { wahr($_[0]) || (defined $_[0] && lc $_[0] eq "only") },
    "push.default"                 => sub { defined $_[0] && $_[0] =~ /^(nothing|current|upstream|tracking|simple|matching)$/i },
    "push.autosetupremote"         => \&wahr,
    "init.defaultbranch"           => sub { defined $_[0] && $_[0] =~ m{^[A-Za-z0-9_][A-Za-z0-9_./-]*$} },
    "fetch.prune"                  => \&wahr,
    "rebase.autostash"             => \&wahr,
    "commit.gpgsign"               => \&wahr,    # git-sicher setzt -c ...=false darüber
    "tag.gpgsign"                  => \&wahr,
    "push.gpgsign"                 => sub { wahr($_[0]) || (defined $_[0] && lc $_[0] eq "if-asked") },
    "extensions.objectformat"      => sub { defined $_[0] && $_[0] =~ /^(sha1|sha256)$/i },
    "extensions.worktreeconfig"    => \&wahr,
);
# gc.<name>: feste Liste mit Wertprüfung (Zahlen, Zeitangaben, Wahrheitswerte)
sub zahl { defined $_[0] && $_[0] =~ /^[0-9]{1,9}$/ }
sub zeit { defined $_[0] && $_[0] =~ /^(never|now|[0-9][0-9A-Za-z. ]{0,40})$/i }
my %gc = (
    "gc.auto" => \&zahl, "gc.autopacklimit" => \&zahl, "gc.autodetach" => \&wahr,
    "gc.pruneexpire" => \&zeit, "gc.reflogexpire" => \&zeit, "gc.reflogexpireunreachable" => \&zeit, "gc.worktreepruneexpire" => \&zeit,
);
# Schlüssel mit Unterabschnitt: "abschnitt.*.variable"
my %mit = (
    "remote.*.url"            => \&url_ok,
    "remote.*.pushurl"        => \&url_ok,
    "remote.*.fetch"          => sub { defined $_[0] && $_[0] =~ m{^[+^]?[^\s\x00-\x1f\x7f-][^\s\x00-\x1f\x7f]*$} },
    "branch.*.remote"         => sub { defined $_[0] && $_[0] =~ m{^(\.|[A-Za-z0-9_][A-Za-z0-9_.-]*)$} },
    "branch.*.pushremote"     => sub { defined $_[0] && $_[0] =~ m{^[A-Za-z0-9_][A-Za-z0-9_.-]*$} },
    "branch.*.merge"          => sub { defined $_[0] && $_[0] =~ m{^[^\s\x00-\x1f\x7f-]\S*$} },
    "branch.*.rebase"         => sub { wahr($_[0]) || (defined $_[0] && $_[0] =~ /^(merges|interactive)$/i) },
    "branch.*.description"    => \&text,
    "branch.*.vscode-merge-base" => \&text,    # schreibt VS Code in jedes Repo, das es öffnet
);

my $hooks;
my (%gesehen, $verboten);
for (my $i = 0; $i + 1 <= $#t; $i += 2) {
    my ($scope, $eintrag) = ($t[$i], $t[$i + 1]);
    next unless $scope eq "local" || $scope eq "worktree";
    my ($schluessel, $wert) = split(/\n/, $eintrag, 2);   # ohne "\n" im Eintrag: Schlüssel ohne Wert ($wert bleibt undef)
    my $name = $schluessel;
    $name =~ s/[^\x20-\x7e]/?/g;
    $name = substr($name, 0, 120);
    # Abschnitt / Unterabschnitt / Variable: Abschnitt bis zum ersten Punkt, Variable nach dem letzten (beide ohne Groß/klein)
    my ($abschnitt, $rest) = split(/\./, $schluessel, 2);
    my $ok = 0;
    if (defined $rest) {
        my ($unter, $var);
        if ($rest =~ /^(.*)\.([^.]*)$/s) { ($unter, $var) = ($1, $2); } else { ($unter, $var) = (undef, $rest); }
        my $a = lc $abschnitt;
        if (!defined $unter) {
            my $k = $a . "." . lc $var;
            if ($gc{$k}) { $ok = $gc{$k}->($wert) ? 1 : 0; }
            elsif ($ohne{$k}) { $ok = $ohne{$k}->($wert) ? 1 : 0; $hooks = $wert if $k eq "core.hookspath" && $ok; }
        } else {
            my $k = $a . ".*." . lc $var;
            $ok = ($mit{$k} && $unter ne "" ? ($mit{$k}->($wert) ? 1 : 0) : 0);
        }
    }
    unless ($ok) {
        print "REFUSE\t$name\n" unless $gesehen{$name}++;
        exit 1 unless $alle;
        $verboten = 1;
    }
}
exit 1 if $verboten;
print "OK\n";
print "HOOKSPATH\t$hooks\n" if defined $hooks;
exit 0;
