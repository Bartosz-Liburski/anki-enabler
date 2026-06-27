# Anki enabler

### Główny problem 
Ucząc się języka obcego zapisałem setki screenshotów z ćwiczeń ważniejszych wyrażeń i struktur gramatycznych - ręczne przepisywanie tych materiałów do Anki jest czasochłonne, a znajdowanie i nauka z rozproszonych screenshotów nieefaktywna.

### Zestaw funkcjonalności dla MVP
1. Wprowadzanie źródeł które użytkownik chce powatarzać i mieć zapisane w apliakcji
2. Źródłem mogą być screenshoty lub proste plki tekstowe ze słowami piosenki lub traskrypcjami filmów
3. Generowanie konkretnych fiszek (kart typu pytanie i odpowiedź) z danego zestawu źródeł
4. UI do przeglądania źródeł i wygenerowanych z nich fiszek
5. Możliwość usunięcia, modyfickacji fiszki/źródła
6. Eksport fiszek do pliku csv do przekazania do aplikacji nauki typu spaced repetition

### Co NIE wchodzi w zakres MVP
1. Własny algorytm do nauki spaced repetition
2. Import skomplikowanych formatów (np. akceptujemy txt z transkrypcją filmu, ale nie sam film). W MVP dodajemy również limit plików do jakiejś ilości znaków tak aby AI tworzące fiszki mogło nad tym pracować bez generowania dużych kosztów.
3. Eksport skomplikowanych formatów (np format .apkg)
4. Funkcje interakcji z użytkownikami (dzielenie się fiszkami, źródłami, wysyłanie wiadomości itp)
5. Wykonujemy jedynie aplikację WEB-ową

### Kryteria sukcesu
1. Podpięty do projektu AI potrafi sam tłumaczyć źródła (screenshots itp) na konkretne fiszki tak aby przynajmniej 3/4 fiszek została nie usunięta i nadawała się do eksportu